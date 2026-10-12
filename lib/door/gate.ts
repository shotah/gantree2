import { bearerToken } from "@/lib/chat/session";
import { parseEntry } from "./allowlist";
import { isLoopback, openSession, readCookie, SESSION_COOKIE, sessionKey } from "./session";
import { hasAdmins, type Resolved, resolveUser, type UserStore, type UsersEnv } from "./users";

/**
 * The gate every non-public request passes. Pure: request + env + store in,
 * decision out. middleware.ts adapts the decision to a Response.
 */
export type GateEnv = UsersEnv & {
  SESSION_SECRET?: string;
  GANTREE_DEV_USER?: string;
};

export type Principal = Resolved & { sub: string; email: string | null };

export type Decision
  = | { kind: "public" }
    | { kind: "pass"; who: Principal }
    | { kind: "login"; next: string }
    | { kind: "unauthorized"; status: 401 | 503; reason: string };

const PUBLIC_EXACT = new Set(["/login", "/api/auth/google", "/api/auth/callback/google", "/api/auth/catch", "/api/health", "/api/auth/config", "/api/auth/nonce", "/api/auth/token", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/favicon.ico", "/robots.txt"]);
const PUBLIC_PREFIX = ["/_vinext/", "/.well-known/", "/_next/", "/assets/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }
  return PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

/**
 * Agent face / wallpaper / mood (`chat__avatar_update` and friends). The
 * room presents its bearer, never a cookie — the same token it dials
 * `/ws/<slug>` with. Only these three paths, and only when a bearer header is
 * on the request; `admitRoom` (`lib/avatar/http`) then checks that token
 * against `AGENT_BEARERS` or the Agent DO row. A cookie here is gated as usual.
 */
const ROOM_PATH = /^\/api\/chat\/(?:avatar|backdrop|theme)$/;

export function isAgentRoomRequest(req: Request): boolean {
  return ROOM_PATH.test(new URL(req.url).pathname) && Boolean(bearerToken(req.headers.get("Authorization")));
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/ws/");
}

/** Agents console, settings, and user management — admin only. */
export function isAdminConsolePath(pathname: string): boolean {
  if (pathname === "/settings" || pathname === "/users") {
    return true;
  }
  if (pathname === "/agents" || pathname.startsWith("/agents/")) {
    return true;
  }
  if (pathname === "/api/agents" || pathname.startsWith("/api/agents/")) {
    return true;
  }
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) {
    return true;
  }
  return false;
}

const AGENT_SLUG_ONLY = /^\/api\/agents\/[a-z][a-z0-9-]{0,31}$/;
const AGENT_ENABLED = /^\/api\/agents\/[a-z][a-z0-9-]{0,31}\/enabled$/;

/** Turn off, turn on, and destroy for an agent you may control — not the rest of the console. */
export function isAgentSelfServiceApi(pathname: string, method: string): boolean {
  const verb = method.toUpperCase();
  if (verb === "DELETE" && AGENT_SLUG_ONLY.test(pathname)) {
    return true;
  }
  return verb === "POST" && AGENT_ENABLED.test(pathname);
}

/** After the door passes: non-admin hits on console paths redirect or 403. */
export function adminConsoleRefusal(who: Principal, url: URL, method = "GET"): Response | null {
  if (who.role === "admin" || !isAdminConsolePath(url.pathname)) {
    return null;
  }
  if (isAgentSelfServiceApi(url.pathname, method)) {
    return null;
  }
  if (isApiPath(url.pathname)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.redirect(new URL("/chat", url.origin).toString(), 302);
}

/** `next` must be a same-origin path. Anything else goes home. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/";
  }
  return raw;
}

/** GANTREE_DEV_USER=sub:email, honored on loopback only. */
export function devIdentity(env: GateEnv, url: URL): { sub: string; email: string | null } | null {
  const raw = env.GANTREE_DEV_USER?.trim();
  if (!raw || !isLoopback(url)) {
    return null;
  }
  const entry = parseEntry(raw);
  if (!entry?.sub) {
    return null;
  }
  return { sub: entry.sub, email: entry.email };
}

export async function gate(req: Request, env: GateEnv, store: UserStore, now = Date.now()): Promise<Decision> {
  const url = new URL(req.url);
  // A bearer on /api/chat/{avatar,backdrop,theme} is the room token,
  // not a session JWE. isAgentRoomRequest stays ahead of the session read.
  if (isPublicPath(url.pathname) || isAgentRoomRequest(req)) {
    return { kind: "public" };
  }
  if (!hasAdmins(env)) {
    return { kind: "unauthorized", status: 503, reason: "no admins: set GANTREE_ADMINS" };
  }

  let identity = devIdentity(env, url);
  if (!identity && env.SESSION_SECRET) {
    try {
      const key = await sessionKey(env.SESSION_SECRET);
      const cookie = readCookie(req, SESSION_COOKIE);
      // Cookie wins when it opens. Otherwise the bearer, the same session JWE
      // phones store. Same fall-through as `readChatSession`.
      if (cookie) {
        identity = await openSession(key, cookie, now);
      }
      if (!identity) {
        const bearer = bearerToken(req.headers.get("Authorization"));
        if (bearer) {
          identity = await openSession(key, bearer, now);
        }
      }
    } catch {
      identity = null;
    }
  }
  if (!identity) {
    return isApiPath(url.pathname)
      ? { kind: "unauthorized", status: 401, reason: "unauthorized" }
      : { kind: "login", next: safeNext(url.pathname + url.search) };
  }

  // A session only proves who. Whether is the list, every time.
  const user = await resolveUser(env, store, { sub: identity.sub, email: identity.email, emailVerified: true });
  if (!user) {
    return { kind: "unauthorized", status: 401, reason: "unauthorized" };
  }
  return { kind: "pass", who: { ...user, sub: identity.sub, email: identity.email } };
}

/** Every name `principalHeaders` writes. Middleware strips these from the client before the gate speaks. */
export const PRINCIPAL_HEADER_NAMES = ["x-gantree-sub", "x-gantree-email", "x-gantree-role", "x-gantree-agents"] as const;

/** Headers handlers read instead of re-opening the cookie. Only middleware writes them (`forwardHeaders`). */
export function principalHeaders(who: Principal): Record<(typeof PRINCIPAL_HEADER_NAMES)[number], string> {
  return {
    "x-gantree-sub": who.sub,
    "x-gantree-email": who.email ?? "",
    "x-gantree-role": who.role,
    "x-gantree-agents": who.agents.join(","),
  };
}

export function principalFromHeaders(h: Headers): Principal | null {
  const sub = h.get("x-gantree-sub");
  const role = h.get("x-gantree-role");
  if (!sub || (role !== "admin" && role !== "operator" && role !== "member")) {
    return null;
  }
  const email = h.get("x-gantree-email") || null;
  const agents = (h.get("x-gantree-agents") ?? "").split(",").filter(Boolean);
  return { sub, email, role, agents, entry: { sub, email } };
}

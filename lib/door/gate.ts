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

/** The PNG icons are what Chrome fetches, without cookies, before it offers Install — and what a push card shows. */
const PUBLIC_EXACT = new Set(["/login", "/api/auth/google", "/api/auth/callback/google", "/api/auth/catch", "/api/health", "/api/auth/config", "/api/auth/nonce", "/api/auth/token", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/favicon.ico", "/robots.txt"]);
const PUBLIC_PREFIX = ["/_vinext/", "/.well-known/", "/_next/", "/assets/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }
  return PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

/**
 * Agent face / wallpaper / mood. The harness presents its room bearer, never
 * a cookie — the same token it dials `/ws/<slug>` with. Only these three
 * paths, and only when a bearer header is on the request. A bearer that
 * opens as a session JWE is the phone (`gate` does not take the public
 * shortcut); `admitRoom` then checks a non-session token against
 * `AGENT_BEARERS` or the Agent DO row. A cookie here is gated as usual.
 */
const ROOM_PATH = /^\/api\/chat\/(?:avatar|backdrop|theme)$/;

export function isAgentRoomRequest(req: Request): boolean {
  return ROOM_PATH.test(new URL(req.url).pathname) && Boolean(bearerToken(req.headers.get("Authorization")));
}

/** True when `Authorization` is a session JWE, so the phone door can run. */
async function bearerOpensSession(req: Request, env: GateEnv, now: number): Promise<boolean> {
  const token = bearerToken(req.headers.get("Authorization"));
  const secret = env.SESSION_SECRET?.trim();
  if (!token || !secret) {
    return false;
  }
  try {
    const key = await sessionKey(secret);
    return (await openSession(key, token, now)) != null;
  } catch {
    return false;
  }
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/ws/");
}

/** Agents console, settings, and user management — admin only; agent-scoped paths pass through to handler control checks. */
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

const AGENT_SLUG = "[a-z][a-z0-9-]{0,31}";
const AGENT_PAGE = new RegExp(`^/agents/${AGENT_SLUG}$`);
const AGENT_API = new RegExp(`^/api/agents/${AGENT_SLUG}(?:/.*)?$`);

/** One agent's page and its APIs. Who may touch that agent is the handler's check (`requireAgentControl`). */
export function isAgentScopedPath(pathname: string): boolean {
  if (pathname === "/agents/new") {
    return false;
  }
  return AGENT_PAGE.test(pathname) || AGENT_API.test(pathname);
}

/** After the door passes: non-admin hits on console paths redirect or 403. Agent-scoped paths pass through to the handler's control check. */
export function adminConsoleRefusal(who: Principal, url: URL): Response | null {
  if (who.role === "admin" || !isAdminConsolePath(url.pathname)) {
    return null;
  }
  if (isAgentScopedPath(url.pathname)) {
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
  // A non-session bearer on /api/chat/{avatar,backdrop,theme} is the room
  // token. A session JWE is the phone and continues through the door.
  if (isPublicPath(url.pathname) || (isAgentRoomRequest(req) && !(await bearerOpensSession(req, env, now)))) {
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

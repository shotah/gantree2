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

const PUBLIC_EXACT = new Set(["/login", "/api/auth/google", "/api/auth/callback/google", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/favicon.ico", "/robots.txt"]);
const PUBLIC_PREFIX = ["/_vinext/", "/.well-known/", "/_next/", "/assets/"];

/**
 * Harness snapshot GET/PUT. Signed with the room bearer (`lib/agents/snapshot`);
 * no session cookie. Only the snapshot files, not the rest of `/api/agents`.
 */
const SNAPSHOT_PATH = /^\/api\/agents\/[a-z][a-z0-9-]{0,62}\/snapshot\/(?:gantry_db|self_md|tokens_tar)$/;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }
  if (SNAPSHOT_PATH.test(pathname)) {
    return true;
  }
  return PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

/**
 * Agent face / wallpaper / mood (`chat__avatar_update` and friends). The
 * harness presents the room bearer, never a cookie — the same token it dials
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
  if (isPublicPath(url.pathname) || isAgentRoomRequest(req)) {
    return { kind: "public" };
  }
  if (!hasAdmins(env)) {
    return { kind: "unauthorized", status: 503, reason: "no admins: set GANTREE_ADMINS" };
  }

  let identity = devIdentity(env, url);
  if (!identity) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token && env.SESSION_SECRET) {
      try {
        identity = await openSession(await sessionKey(env.SESSION_SECRET), token, now);
      } catch {
        identity = null;
      }
    }
  }
  if (!identity) {
    return isApiPath(url.pathname)
      ? { kind: "unauthorized", status: 401, reason: "unauthorized" }
      : { kind: "login", next: safeNext(url.pathname + url.search) };
  }

  // A cookie only proves who. Whether is the list, every time.
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

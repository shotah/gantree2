/**
 * The door as HTTP. Pure request → response given env + store, so the route
 * files under app/api/auth stay one line each and this file is what tests hit.
 */
import type { JWTVerifyGetKey } from "jose";
import { gate, type GateEnv, safeNext } from "./gate";
import { authorizeUrl, exchangeCode, type GoogleEnv, randomToken, verifyIdToken } from "./google";
import {
  clearCookieHeader,
  cookieHeader,
  OAUTH_COOKIE,
  OAUTH_TTL_S,
  openOAuth,
  readCookie,
  sealOAuth,
  sealSession,
  SESSION_COOKIE,
  SESSION_TTL_S,
  sessionKey,
} from "./session";
import { resolveUser, type UserStore } from "./users";

export type DoorEnv = GateEnv & GoogleEnv;

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function loginUrl(url: URL, next: string, error?: string): string {
  const to = new URL("/login", url.origin);
  if (next !== "/") {
    to.searchParams.set("next", next);
  }
  if (error) {
    to.searchParams.set("error", error);
  }
  return to.toString();
}

/** GET /api/auth/google?next=/x → 302 to Google with state+nonce+PKCE sealed in a short cookie. */
export async function startGoogle(req: Request, env: DoorEnv): Promise<Response> {
  const url = new URL(req.url);
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
    return json({ error: "login not configured: GOOGLE_CLIENT_ID and SESSION_SECRET" }, 503);
  }
  const claims = {
    state: randomToken(16),
    nonce: randomToken(16),
    verifier: randomToken(48),
    next: safeNext(url.searchParams.get("next")),
  };
  const key = await sessionKey(env.SESSION_SECRET);
  const cookie = await sealOAuth(key, claims);
  const to = await authorizeUrl({ clientId: env.GOOGLE_CLIENT_ID, origin: url.origin, ...claims });
  return new Response(null, {
    status: 302,
    headers: { "location": to, "set-cookie": cookieHeader(OAUTH_COOKIE, cookie, url, OAUTH_TTL_S), "cache-control": "no-store" },
  });
}

/**
 * GET /api/auth/callback/google?code&state. Checks state against the cookie,
 * swaps code for an ID token, verifies it, checks the list, seals the session.
 * Any miss bounces to /login?error=… and never sets a session.
 */
export async function finishGoogle(
  req: Request,
  env: DoorEnv,
  store: UserStore,
  deps: { fetchFn?: typeof fetch; key?: JWTVerifyGetKey | CryptoKey | Uint8Array; now?: number } = {},
): Promise<Response> {
  const url = new URL(req.url);
  const clearOauth = clearCookieHeader(OAUTH_COOKIE, url);
  const bounce = (error: string, next = "/") =>
    new Response(null, { status: 302, headers: { "location": loginUrl(url, next, error), "set-cookie": clearOauth, "cache-control": "no-store" } });

  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
    return bounce("not_configured");
  }
  const key = await sessionKey(env.SESSION_SECRET);
  const raw = readCookie(req, OAUTH_COOKIE);
  const oauth = raw ? await openOAuth(key, raw, deps.now) : null;
  if (!oauth) {
    return bounce("expired");
  }
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== oauth.state) {
    return bounce("state", oauth.next);
  }
  const token = await exchangeCode({ env, origin: url.origin, code, verifier: oauth.verifier, fetchFn: deps.fetchFn });
  if (!token.ok) {
    return bounce("exchange", oauth.next);
  }
  const verified = await verifyIdToken({ idToken: token.idToken, clientId: env.GOOGLE_CLIENT_ID, nonce: oauth.nonce, key: deps.key, now: deps.now });
  if (!verified.ok) {
    return bounce("token", oauth.next);
  }
  const user = await resolveUser(env, store, verified.who);
  if (!user) {
    return bounce("not_allowed", oauth.next);
  }
  const session = await sealSession(key, { sub: verified.who.sub, email: verified.who.email }, deps.now);
  const headers = new Headers({ "location": new URL(oauth.next, url.origin).toString(), "cache-control": "no-store" });
  headers.append("set-cookie", cookieHeader(SESSION_COOKIE, session, url, SESSION_TTL_S));
  headers.append("set-cookie", clearOauth);
  return new Response(null, { status: 302, headers });
}

/** POST /api/auth/logout → clears the session; 303 to /login. */
export function logout(req: Request): Response {
  const url = new URL(req.url);
  return new Response(null, {
    status: 303,
    headers: { "location": loginUrl(url, "/"), "set-cookie": clearCookieHeader(SESSION_COOKIE, url), "cache-control": "no-store" },
  });
}

/** GET /api/auth/me → the principal, or 401 / 503 from the gate. */
export async function me(req: Request, env: DoorEnv, store: UserStore): Promise<Response> {
  const d = await gate(req, env, store);
  if (d.kind === "pass") {
    return json({ sub: d.who.sub, email: d.who.email, role: d.who.role, agents: d.who.agents });
  }
  if (d.kind === "unauthorized") {
    return json({ error: d.reason }, d.status);
  }
  return json({ error: "unauthorized" }, 401);
}

/** What middleware does with a gate decision for a page or API hit. `null` = let it through. */
export async function guard(req: Request, env: DoorEnv, store: UserStore): Promise<Response | null> {
  const d = await gate(req, env, store);
  const url = new URL(req.url);
  switch (d.kind) {
    case "public":
    case "pass":
      return null;
    case "login":
      return Response.redirect(loginUrl(url, d.next), 302);
    case "unauthorized":
      return json({ error: d.reason }, d.status);
  }
}

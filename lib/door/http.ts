/**
 * The door as HTTP. Pure request → response given env + store, so the route
 * files under app/api/auth stay one line each and this file is what tests hit.
 */
import type { JWTVerifyGetKey } from "jose";
import { type Decision, gate, type GateEnv, type Principal, PRINCIPAL_HEADER_NAMES, principalHeaders, safeNext } from "./gate";
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

export type EffectiveGoogle = { clientId: string; clientSecret?: string };

/** GET /api/auth/google?next=/x → 302 to Google with state+nonce+PKCE sealed in a short cookie. */
export async function startGoogle(req: Request, env: DoorEnv, google?: EffectiveGoogle): Promise<Response> {
  const url = new URL(req.url);
  const clientId = google?.clientId?.trim() || env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId || !env.SESSION_SECRET) {
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
  const to = await authorizeUrl({ clientId, origin: url.origin, ...claims });
  return new Response(null, {
    status: 302,
    headers: { location: to, "set-cookie": cookieHeader(OAUTH_COOKIE, cookie, url, OAUTH_TTL_S), "cache-control": "no-store" },
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
  deps: {
    fetchFn?: typeof fetch;
    key?: JWTVerifyGetKey | CryptoKey | Uint8Array;
    now?: number;
    google?: EffectiveGoogle;
  } = {},
): Promise<Response> {
  const url = new URL(req.url);
  const clearOauth = clearCookieHeader(OAUTH_COOKIE, url);
  const bounce = (error: string, next = "/") =>
    new Response(null, { status: 302, headers: { location: loginUrl(url, next, error), "set-cookie": clearOauth, "cache-control": "no-store" } });

  const clientId = deps.google?.clientId?.trim() || env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = deps.google?.clientSecret?.trim() || env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !env.SESSION_SECRET) {
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
  const token = await exchangeCode({
    env: { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret },
    origin: url.origin,
    code,
    verifier: oauth.verifier,
    fetchFn: deps.fetchFn,
  });
  if (!token.ok) {
    // Status only, never the body: "token endpoint 401" is Google refusing
    // the client secret; "google client not configured" is a missing var.
    console.warn("door: google token exchange failed:", token.error);
    return bounce("exchange", oauth.next);
  }
  const verified = await verifyIdToken({ idToken: token.idToken, clientId, nonce: oauth.nonce, key: deps.key, now: deps.now });
  if (!verified.ok) {
    return bounce("token", oauth.next);
  }
  const user = await resolveUser(env, store, verified.who);
  if (!user) {
    return bounce("not_allowed", oauth.next);
  }
  const session = await sealSession(key, { sub: verified.who.sub, email: verified.who.email }, deps.now);
  const headers = new Headers({ location: new URL(oauth.next, url.origin).toString(), "cache-control": "no-store" });
  headers.append("set-cookie", cookieHeader(SESSION_COOKIE, session, url, SESSION_TTL_S));
  headers.append("set-cookie", clearOauth);
  return new Response(null, { status: 302, headers });
}

/** POST /api/auth/logout → clears the session; 303 to /login. */
export function logout(req: Request): Response {
  const url = new URL(req.url);
  return new Response(null, {
    status: 303,
    headers: { location: loginUrl(url, "/"), "set-cookie": clearCookieHeader(SESSION_COOKIE, url), "cache-control": "no-store" },
  });
}

/**
 * GET /api/auth/me → the principal, or 401 / 503 from the gate.
 *
 * `agents` is the union of the Settings grants and whatever `rooms` admits
 * (chat room membership). `cranes` is an alias copy: gantree-android and
 * gantree-ios read `agents` and fall back to it; dropped at the Phase 4 cutover.
 */
export async function me(
  req: Request,
  env: DoorEnv,
  store: UserStore,
  rooms?: (who: Principal) => Promise<string[]>,
): Promise<Response> {
  const d = await gate(req, env, store);
  if (d.kind === "pass") {
    const admitted = rooms ? await rooms(d.who) : [];
    const agents = [...new Set([...d.who.agents, ...admitted])].sort();
    return json({ sub: d.who.sub, email: d.who.email, role: d.who.role, agents, cranes: [...agents] });
  }
  if (d.kind === "unauthorized") {
    return json({ error: d.reason }, d.status);
  }
  return json({ error: "unauthorized" }, 401);
}

/** What middleware does with a gate decision for a page or API hit. `null` = let it through. */
export async function guard(req: Request, env: DoorEnv, store: UserStore): Promise<Response | null> {
  return refusal(await gate(req, env, store), new URL(req.url));
}

/**
 * Request headers the handlers behind the door will see. Client-sent
 * `x-gantree-*` is always dropped — `principalFromHeaders` trusts those names,
 * so only the gate may write them — and a `pass` writes the resolved principal.
 */
export function forwardHeaders(d: Decision, incoming: Headers): Headers {
  const h = new Headers(incoming);
  for (const name of PRINCIPAL_HEADER_NAMES) {
    h.delete(name);
  }
  if (d.kind === "pass") {
    for (const [name, value] of Object.entries(principalHeaders(d.who))) {
      h.set(name, value);
    }
  }
  return h;
}

/** The response a decision refuses with, or `null` when the request may go on. */
export function refusal(d: Decision, url: URL): Response | null {
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

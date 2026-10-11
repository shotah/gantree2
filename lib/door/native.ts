/**
 * Native sign-in for cab and helm. Google runs on the phone; these routes
 * never read or set a cookie (`CookieJar.NO_COOKIES`).
 */
import type { JWTVerifyGetKey } from "jose";
import { PACKAGE_VERSION } from "@/app/lib/release";
import { readTts, voiceOffered, type TtsEnv } from "@/lib/tts/http";
import { verifyIdToken } from "./google";
import { json, type DoorEnv } from "./http";
import { isLoopback, openNonce, sealNonce, sealSession, SESSION_TTL_S, sessionKey } from "./session";
import { resolveUser, type UserStore } from "./users";

/** POST /api/chat/tts can synthesize. A missing key, or `VOICE=off`, is false. */
function voiceUsable(env: TtsEnv): boolean {
  return voiceOffered(env) && readTts(env) !== null;
}

/** GET /api/auth/config — public. Phones read this before showing Google. */
export function authConfig(req: Request, env: DoorEnv & TtsEnv): Response {
  const google = Boolean(env.GOOGLE_CLIENT_ID && env.SESSION_SECRET);
  return json({
    mode: google ? "google" : "spike",
    google,
    voice: voiceUsable(env),
    version: PACKAGE_VERSION,
    dev: isLoopback(new URL(req.url)),
  });
}

/** GET /api/auth/nonce — a stateless JWE the phone hands to Google as `nonce`. */
export async function authNonce(env: DoorEnv): Promise<Response> {
  if (!env.SESSION_SECRET) {
    return json({ error: "not_configured" }, 503);
  }
  const nonce = await sealNonce(await sessionKey(env.SESSION_SECRET));
  return json({ nonce });
}

type TokenDeps = { key?: JWTVerifyGetKey | CryptoKey | Uint8Array; now?: number };

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await req.json<unknown>();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tokenFields(body: Record<string, unknown> | null): { idToken: string; nonce: string } | null {
  if (!body) {
    return null;
  }
  const idToken = body.id_token;
  const nonce = body.nonce;
  if (typeof idToken !== "string" || idToken.length === 0 || typeof nonce !== "string" || nonce.length === 0) {
    return null;
  }
  return { idToken, nonce };
}

/**
 * POST /api/auth/token — `{ id_token, nonce }` → the same session JWE the
 * `gantree_session` cookie holds. `exp` is epoch seconds.
 */
export async function authToken(req: Request, env: DoorEnv, store: UserStore, deps: TokenDeps = {}): Promise<Response> {
  const fields = tokenFields(await readJson(req));
  if (!fields) {
    return json({ error: "bad_request" }, 400);
  }
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
    return json({ error: "not_configured" }, 503);
  }
  const now = deps.now ?? Date.now();
  const key = await sessionKey(env.SESSION_SECRET);
  // The posted string is the JWE from GET /api/auth/nonce, verbatim. Google
  // echoes that string in the ID token; the inner `n` claim is not compared.
  if (!(await openNonce(key, fields.nonce, now))) {
    return json({ error: "nonce" }, 401);
  }
  // Audience is the web client id. The apps pass that same id as
  // `serverClientId` / `GIDServerClientID`, so Google sets `aud` to GOOGLE_CLIENT_ID.
  const verified = await verifyIdToken({
    idToken: fields.idToken,
    clientId: env.GOOGLE_CLIENT_ID,
    nonce: fields.nonce,
    key: deps.key,
    now,
  });
  if (!verified.ok) {
    return json({ error: "token" }, 401);
  }
  const user = await resolveUser(env, store, verified.who);
  if (!user) {
    return json({ error: "not_allowed", sub: verified.who.sub, email: verified.who.email }, 403);
  }
  const token = await sealSession(key, { sub: verified.who.sub, email: verified.who.email }, now);
  const exp = Math.floor(now / 1000) + SESSION_TTL_S;
  return json({ token, sub: verified.who.sub, email: verified.who.email, exp });
}

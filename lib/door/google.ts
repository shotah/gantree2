import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyObject } from "jose";
import type { Identity } from "./allowlist";

/**
 * Google OIDC, Authorization Code + PKCE. The only login.
 * Verification is `jose` against Google's JWKS; nothing hand-rolled.
 */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const CALLBACK_PATH = "/api/auth/callback/google";

export type GoogleEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function redirectUri(origin: string): string {
  return `${origin}${CALLBACK_PATH}`;
}

export async function authorizeUrl(opts: {
  clientId: string;
  origin: string;
  state: string;
  nonce: string;
  verifier: string;
}): Promise<string> {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", redirectUri(opts.origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", opts.state);
  u.searchParams.set("nonce", opts.nonce);
  u.searchParams.set("code_challenge", await pkceChallenge(opts.verifier));
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export async function exchangeCode(opts: {
  env: GoogleEnv;
  origin: string;
  code: string;
  verifier: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: true; idToken: string } | { ok: false; error: string }> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = opts.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { ok: false, error: "google client not configured" };
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.verifier,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(opts.origin),
  });
  const res = await (opts.fetchFn ?? fetch)(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    return { ok: false, error: `token endpoint ${res.status}` };
  }
  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string") {
    return { ok: false, error: "no id_token" };
  }
  return { ok: true, idToken: json.id_token };
}

let jwks: JWTVerifyGetKey | null = null;
export function googleJwks(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

/**
 * iss, aud, exp, signature via `jose`; nonce by hand because it is ours.
 * Returns the identity the allowlist is checked against.
 */
export async function verifyIdToken(opts: {
  idToken: string;
  clientId: string;
  nonce: string;
  key?: JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;
  now?: number;
}): Promise<{ ok: true; who: Identity } | { ok: false; error: string }> {
  try {
    const key = opts.key ?? googleJwks();
    const { payload } = await jwtVerify(opts.idToken, key as JWTVerifyGetKey, {
      issuer: GOOGLE_ISSUERS,
      audience: opts.clientId,
      currentDate: opts.now ? new Date(opts.now) : undefined,
    });
    if (payload.nonce !== opts.nonce) {
      return { ok: false, error: "nonce mismatch" };
    }
    if (typeof payload.sub !== "string" || !payload.sub) {
      return { ok: false, error: "no sub" };
    }
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    const emailVerified = payload.email_verified === true;
    return { ok: true, who: { sub: payload.sub, email, emailVerified } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "verify failed" };
  }
}

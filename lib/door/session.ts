import { EncryptJWT, jwtDecrypt } from "jose";
import { randomToken } from "./google";

/**
 * Cookies. Both are JWE (dir + A256GCM) under a key derived from
 * SESSION_SECRET. The session carries identity only; role is recomputed on
 * every request from env + the user store.
 */
export const SESSION_COOKIE = "gantree_session";
export const OAUTH_COOKIE = "gantree_oauth";
/** Hard expiry from sign-in. No idle bump. Matches today's chat. */
export const SESSION_TTL_S = 7 * 24 * 60 * 60;
export const OAUTH_TTL_S = 10 * 60;

const ISSUER = "gantree";

export type SessionClaims = {
  sub: string;
  email: string | null;
};

export type OAuthClaims = {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
};

export async function sessionKey(secret: string): Promise<Uint8Array> {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

async function seal(key: Uint8Array, aud: string, claims: Record<string, unknown>, ttlS: number, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlS)
    .encrypt(key);
}

async function open(key: Uint8Array, aud: string, token: string, now: number): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtDecrypt(token, key, {
      issuer: ISSUER,
      audience: aud,
      currentDate: new Date(now),
    });
    return payload;
  } catch {
    return null;
  }
}

export async function sealSession(key: Uint8Array, claims: SessionClaims, now = Date.now()): Promise<string> {
  return seal(key, "session", { sub: claims.sub, email: claims.email }, SESSION_TTL_S, now);
}

export async function openSession(key: Uint8Array, token: string, now = Date.now()): Promise<SessionClaims | null> {
  const p = await open(key, "session", token, now);
  if (!p || typeof p.sub !== "string" || !p.sub) {
    return null;
  }
  return { sub: p.sub, email: typeof p.email === "string" ? p.email : null };
}

export async function sealOAuth(key: Uint8Array, claims: OAuthClaims, now = Date.now()): Promise<string> {
  return seal(key, "oauth", { ...claims }, OAUTH_TTL_S, now);
}

export async function openOAuth(key: Uint8Array, token: string, now = Date.now()): Promise<OAuthClaims | null> {
  const p = await open(key, "oauth", token, now);
  if (!p) {
    return null;
  }
  const { state, nonce, verifier, next } = p;
  if (typeof state !== "string" || typeof nonce !== "string" || typeof verifier !== "string") {
    return null;
  }
  return { state, nonce, verifier, next: typeof next === "string" ? next : "/" };
}

/** Native sign-in. Google echoes the compact JWE; it has to stay under 255 characters. */
export const NONCE_TTL_S = 10 * 60;

export type NonceClaims = {
  n: string;
};

export async function sealNonce(key: Uint8Array, now = Date.now()): Promise<string> {
  return seal(key, "nonce", { n: randomToken(16) }, NONCE_TTL_S, now);
}

/** Null when the nonce is not ours, expired, or tampered. */
export async function openNonce(key: Uint8Array, token: string, now = Date.now()): Promise<NonceClaims | null> {
  const p = await open(key, "nonce", token, now);
  if (!p || typeof p.n !== "string" || !p.n) {
    return null;
  }
  return { n: p.n };
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) {
    return null;
  }
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1 || part.slice(0, eq).trim() !== name) {
      continue;
    }
    const v = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

export function isLoopback(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
}

/** `Secure` everywhere except plain-http loopback dev. */
export function cookieHeader(name: string, value: string, url: URL, maxAgeS: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeS))}`,
  ];
  if (!(url.protocol === "http:" && isLoopback(url))) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearCookieHeader(name: string, url: URL): string {
  return cookieHeader(name, "", url, 0);
}

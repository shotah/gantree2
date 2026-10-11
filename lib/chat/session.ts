import { jwtDecrypt } from "jose";
import { readCookie, SESSION_COOKIE, sessionKey } from "@/lib/door/session";

/**
 * Phone identity for a socket. Cookie `gantree_session`, or the same JWE on
 * `Authorization` for cab and helm. Cookie wins when both are present.
 *
 * `lib/door/session.ts` `openSession` does not return `exp`. This opens the
 * same issuer/audience (`gantree` / `session`) so a long-lived socket can
 * still be closed when the JWE expires. The door's `gate` treats a session
 * email as verified; this does too.
 */
const ISSUER = "gantree";
const AUDIENCE = "session";

export type ChatSession = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  /** JWT `exp` in milliseconds. */
  exp?: number;
};

/** The token after `Authorization: Bearer`, or `undefined`. Header only — never a query string. */
export function bearerToken(authorization: string | null | undefined): string | undefined {
  const header = authorization?.trim() ?? "";
  const prefix = "bearer ";
  if (header.length < prefix.length || header.slice(0, prefix.length).toLowerCase() !== prefix) {
    return undefined;
  }
  const token = header.slice(prefix.length).trim();
  return token || undefined;
}

function cookieValue(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }
  return readCookie(new Request("https://chat.local/", { headers: { cookie: header } }), SESSION_COOKIE);
}

async function openToken(secret: string, token: string, now: number): Promise<ChatSession | null> {
  try {
    const key = await sessionKey(secret);
    const { payload } = await jwtDecrypt(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: new Date(now),
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      return null;
    }
    const email = typeof payload.email === "string" && payload.email ? payload.email : undefined;
    const exp = typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
    return { sub: payload.sub, email, emailVerified: Boolean(email), exp };
  } catch {
    return null;
  }
}

export async function readChatSession(
  secret: string,
  opts: { cookieHeader?: string | null; authorization?: string | null },
  now = Date.now(),
): Promise<ChatSession | null> {
  const fromCookie = cookieValue(opts.cookieHeader);
  if (fromCookie) {
    const claims = await openToken(secret, fromCookie, now);
    if (claims) {
      return claims;
    }
  }
  const fromAuth = bearerToken(opts.authorization);
  if (!fromAuth) {
    return null;
  }
  return openToken(secret, fromAuth, now);
}

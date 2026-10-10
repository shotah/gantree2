/** Login page helpers. Pure, so the page stays a shell. */

import { devIdentity, safeNext } from "@/lib/door/gate";

const ERRORS: Record<string, string> = {
  not_configured: "Login is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and SESSION_SECRET.",
  expired: "That sign-in took too long. Try again.",
  state: "Sign-in did not match what we sent. Try again.",
  exchange: "Google did not accept the sign-in. Try again.",
  token: "Google's answer did not check out. Try again.",
  not_allowed: "That Google account is not on the list.",
};

export function loginError(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return ERRORS[code] ?? "Sign-in failed. Try again.";
}

export function loginHref(next: string | null | undefined): string {
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  return safe ? `/api/auth/google?next=${encodeURIComponent(safe)}` : "/api/auth/google";
}

export type DevDoor = { label: string; href: string };

/**
 * The loopback bypass the gate already honours: with `GANTREE_DEV_USER` set
 * and the request on 127.0.0.1 / localhost, every page passes without a
 * cookie, so the door only needs to point at `next`. Null anywhere else.
 */
export function devDoor(
  env: { GANTREE_DEV_USER?: string },
  host: string | null | undefined,
  next: string | null | undefined,
): DevDoor | null {
  if (!host) {
    return null;
  }
  let url: URL;
  try {
    url = new URL("/login", `http://${host}`);
  } catch {
    return null;
  }
  const who = devIdentity(env, url);
  if (!who) {
    return null;
  }
  return { label: who.email ?? who.sub, href: safeNext(next) };
}

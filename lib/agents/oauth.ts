/**
 * OAuth lands on the Worker. This module does not read `OAUTH_REDIRECT_URI`.
 */
import type { AgentsEnv } from "@/lib/agents/types";

type OriginEnv = { PUBLIC_ORIGIN?: string };

/**
 * `PUBLIC_ORIGIN` wins. Empty means the fallback (request origin). A set but
 * unusable value fails closed — it does not silently use the browser host.
 */
function resolveOrigin(env: AgentsEnv, fallback?: string): string | null {
  const configured = (env as OriginEnv).PUBLIC_ORIGIN;
  const prefer = typeof configured === "string" ? configured.trim() : "";
  const raw = prefer || fallback?.trim() || "";
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Redirect login. Garmin's login is email, password, and MFA — not this list. */
export const OAUTH_REDIRECT_PLUGINS = ["google", "google-health", "strava"] as const;

export function oauthRedirectPlugin(id: string): boolean {
  return (OAUTH_REDIRECT_PLUGINS as readonly string[]).includes(id);
}

/**
 * Provider redirect URI. `PUBLIC_ORIGIN` wins (path stripped). Otherwise the
 * fallback origin. Empty when neither is a usable http(s) origin — a set but
 * unusable `PUBLIC_ORIGIN` does not fall through.
 */
export function oauthCatchRedirect(env: AgentsEnv & { PUBLIC_ORIGIN?: string }, fallback?: string | null): string {
  const origin = resolveOrigin(env, fallback ?? undefined);
  if (!origin) {
    return "";
  }
  return new URL("/api/auth/catch", origin).toString();
}

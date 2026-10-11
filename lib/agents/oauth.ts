/**
 * Native OAuth lands on the Worker. Container plugins keep their own
 * `*_OAUTH_REDIRECT_URI` keys; this module does not read `OAUTH_REDIRECT_URI`.
 */
import { resolveOrigin } from "@/lib/agents/container";
import type { AgentsEnv } from "@/lib/agents/types";

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

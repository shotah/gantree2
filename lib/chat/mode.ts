import type { ChatAuthEnv } from "./env";

export type AuthMode = "spike" | "oidc";

export type ModeResult = { ok: true; mode: AuthMode } | { ok: false; error: "config" };

export function loopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/**
 * Google configured → session cookie (spike secret is gone).
 * Otherwise `CHAT_SECRET` is the two-tab spike — loopback only.
 * Omit `host` in unit tests; a non-loopback host with only the spike secret is config.
 * Room bearers are per slug (env map or the Agent DO row), not a mode requirement.
 */
export function resolveAuthMode(env: ChatAuthEnv, host?: string): ModeResult {
  if (env.GOOGLE_CLIENT_ID?.trim()) {
    if (!env.SESSION_SECRET?.trim()) {
      return { ok: false, error: "config" };
    }
    return { ok: true, mode: "oidc" };
  }
  if (env.CHAT_SECRET?.trim()) {
    if (host != null && !loopbackHost(host)) {
      return { ok: false, error: "config" };
    }
    return { ok: true, mode: "spike" };
  }
  return { ok: false, error: "config" };
}

/** Platform Google OAuth injected into agent env unless the agent opts into its own client. */

export const GOOGLE_OWN_CLIENT = "GOOGLE_OWN_CLIENT";
export const GOOGLE_HEALTH_OWN_CLIENT = "GOOGLE_HEALTH_OWN_CLIENT";

export const PLATFORM_GOOGLE_LINE = "Uses the platform Google sign-in client.";

const GOOGLE_OAUTH_KEYS = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] as const;
const GOOGLE_HEALTH_KEYS = ["GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET"] as const;

export function googlePlatformToolId(toolId: string): boolean {
  return toolId === "google" || toolId === "google-health";
}

export function googleOwnClientFlag(toolId: string): string | null {
  if (toolId === "google") {
    return GOOGLE_OWN_CLIENT;
  }
  if (toolId === "google-health") {
    return GOOGLE_HEALTH_OWN_CLIENT;
  }
  return null;
}

export function googleOAuthEnvKeys(toolId: string): readonly string[] {
  if (toolId === "google") {
    return GOOGLE_OAUTH_KEYS;
  }
  if (toolId === "google-health") {
    return GOOGLE_HEALTH_KEYS;
  }
  return [];
}

export function usesOwnGoogleClient(toolId: string, envKeys: readonly string[]): boolean {
  const flag = googleOwnClientFlag(toolId);
  return flag !== null && envKeys.includes(flag);
}

export function applyPlatformGoogle(
  env: Record<string, string>,
  agentEnv: Record<string, string>,
  platform: { clientId: string; clientSecret: string },
): Record<string, string> {
  const out = { ...env };
  if (agentEnv[GOOGLE_OWN_CLIENT] !== "1" && platform.clientId.trim()) {
    out.GOOGLE_OAUTH_CLIENT_ID = platform.clientId.trim();
    if (platform.clientSecret.trim()) {
      out.GOOGLE_OAUTH_CLIENT_SECRET = platform.clientSecret.trim();
    }
  }
  if (agentEnv[GOOGLE_HEALTH_OWN_CLIENT] !== "1" && platform.clientId.trim()) {
    out.GOOGLE_HEALTH_CLIENT_ID = platform.clientId.trim();
    if (platform.clientSecret.trim()) {
      out.GOOGLE_HEALTH_CLIENT_SECRET = platform.clientSecret.trim();
    }
  }
  return out;
}

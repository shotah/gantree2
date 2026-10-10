/**
 * House keys — model and search credentials the Worker env carries for every
 * agent (`.dev.vars` locally, Worker secrets on Cloudflare, `CELLD_VARS_FILE`
 * at home). They sit under each agent's own `config.env` in the `config`
 * frame: a key the agent sets wins, a key it leaves blank falls through to
 * the house. Values never leave the Worker over HTTP; screens see key names.
 */
export const HOUSE_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "BRAVE_SEARCH_API_KEY"] as const;

export type HouseKey = typeof HOUSE_KEYS[number];

/** Optional Worker bindings the house reads. Additive to `AgentEnv`. */
export type HouseEnv = Partial<Record<HouseKey, string>>;

/** Non-empty house values from the Worker env, trimmed. */
export function houseEnv(env: HouseEnv | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env) {
    return out;
  }
  for (const key of HOUSE_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/** Key names the house supplies, in `HOUSE_KEYS` order. Safe for a browser. */
export function houseKeys(env: HouseEnv | undefined): string[] {
  return Object.keys(houseEnv(env));
}

/** The three the harness refuses to boot without. */
export const LLM_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const;

/** True when every `LLM_*` key is either typed on the agent or supplied by the house. */
export function llmCovered(agentKeys: readonly string[], house: readonly string[]): boolean {
  return LLM_KEYS.every((key) => agentKeys.includes(key) || house.includes(key));
}

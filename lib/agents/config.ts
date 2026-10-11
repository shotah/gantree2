/**
 * Agent DO config. HTTP sees `AgentConfigView` (env values redacted).
 * A crane socket sees the real env inside the `config` frame.
 * `recreate` is true only after `markStarted` and a later env change.
 */
import type { AgentConfig, AgentConfigView } from "@/lib/agents/types";

export const CONFIG_STORE_KEY = "agent.config";
export const CONFIG_STARTED_KEY = "agent.config.started";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const BANNED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ENV_KEYS_MAX = 64;
const ENV_VALUE_MAX = 16_384;
const TEXT_MAX = 262_144;

export function emptyConfig(): AgentConfig {
  return { env: {}, mcp: "", persona: "", updatedAt: null };
}

export function canonicalEnv(env: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    const value = env[key];
    if (typeof value === "string") {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

/** True when env differs from the blob captured at the last applied start. */
export function needsRecreate(env: Record<string, string>, startedEnv: string | null): boolean {
  if (startedEnv == null) {
    return false;
  }
  return startedEnv !== canonicalEnv(env);
}

export function configView(config: AgentConfig, startedEnv: string | null, house: readonly string[] = []): AgentConfigView {
  return {
    envKeys: Object.keys(config.env).sort(),
    house: [...house],
    mcp: config.mcp,
    persona: config.persona,
    updatedAt: config.updatedAt,
    recreate: needsRecreate(config.env, startedEnv),
  };
}

export function startedEnvFor(config: AgentConfig): string {
  return canonicalEnv(config.env);
}

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function copyEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ENV_KEY.test(key) || BANNED_KEYS.has(key) || typeof value !== "string") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function parseConfig(raw: unknown): AgentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyConfig();
  }
  const row = raw as Record<string, unknown>;
  const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : null;
  return {
    env: copyEnv(row.env),
    mcp: typeof row.mcp === "string" ? row.mcp : "",
    persona: typeof row.persona === "string" ? row.persona : "",
    updatedAt,
  };
}

export type ConfigPatchResult
  = | { ok: true; config: AgentConfig; changed: boolean }
    | { ok: false; error: "bad_config" };

function envKeyOk(key: string): boolean {
  return ENV_KEY.test(key) && !BANNED_KEYS.has(key) && !hasControl(key);
}

export function applyConfigPatch(config: AgentConfig, patch: unknown, now: number): ConfigPatchResult {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "bad_config" };
  }
  const body = patch as Record<string, unknown>;
  const env = { ...config.env };
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(body, "env")) {
    if (!body.env || typeof body.env !== "object" || Array.isArray(body.env)) {
      return { ok: false, error: "bad_config" };
    }
    for (const [key, value] of Object.entries(body.env)) {
      if (!envKeyOk(key)) {
        return { ok: false, error: "bad_config" };
      }
      if (value === null) {
        if (Object.prototype.hasOwnProperty.call(env, key)) {
          delete env[key];
          changed = true;
        }
        continue;
      }
      if (typeof value !== "string" || value.length > ENV_VALUE_MAX || hasControl(value)) {
        return { ok: false, error: "bad_config" };
      }
      if (env[key] !== value) {
        env[key] = value;
        changed = true;
      }
    }
  }
  if (Object.keys(env).length > ENV_KEYS_MAX) {
    return { ok: false, error: "bad_config" };
  }
  let mcp = config.mcp;
  let persona = config.persona;
  if (Object.prototype.hasOwnProperty.call(body, "mcp")) {
    if (typeof body.mcp !== "string" || body.mcp.length > TEXT_MAX) {
      return { ok: false, error: "bad_config" };
    }
    if (mcp !== body.mcp) {
      mcp = body.mcp;
      changed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "persona")) {
    if (typeof body.persona !== "string" || body.persona.length > TEXT_MAX) {
      return { ok: false, error: "bad_config" };
    }
    if (persona !== body.persona) {
      persona = body.persona;
      changed = true;
    }
  }
  return {
    ok: true,
    changed,
    config: changed ? { env, mcp, persona, updatedAt: now } : { ...config, env: config.env },
  };
}

/** Env map the `config` frame sends: house floor, then the agent's own keys. */
export function frameEnv(
  config: AgentConfig,
  house: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...house, ...config.env })) {
    if (key !== "SNAPSHOT_KEY") {
      env[key] = value;
    }
  }
  return env;
}

/**
 * DO → crane socket. Carries env values — the house floor under the agent's own,
 * so a blank `LLM_*` on the agent falls through. Never fan this out to phones.
 */
export function configFrame(
  config: AgentConfig,
  house: Record<string, string> = {},
): string {
  return JSON.stringify({
    kind: "config",
    env: frameEnv(config, house),
    mcp: config.mcp,
    persona: config.persona,
  });
}

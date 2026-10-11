/**
 * The Agent DO's native brain. Builds `BrainDeps` from the room's storage
 * and memoises one `Brain` per DO instance until config (env, slug) or the
 * persona rows change, or `dropRoomBrain` runs.
 */
import { createBrain } from "@/brain/agent";
import type { Brain } from "@/brain/core/brain";
import { systemClock } from "@/brain/core/clock";
import { consoleSink, makeLogger, type LogSink } from "@/brain/core/log";
import type { ProviderConfig } from "@/brain/core/provider";
import { doSql } from "@/brain/core/sql";
import type { LogFrame } from "@/brain/core/wire";
import { resolveTimezone } from "@/brain/persona";
import { bindRoomAuth, type RoomAuth } from "@/brain/room/authbind";
import { filePersona, openPersonaStore, personaParts } from "@/brain/room/persona";
import { allPlugins } from "@/brain/plugins";
import { openaiProvider } from "@/brain/provider";
import { AesTokenStore } from "@/brain/tools";
import { canonicalEnv, CONFIG_STORE_KEY, frameEnv, parseConfig } from "@/lib/agents/config";
import { houseEnv, type HouseEnv } from "@/lib/agents/house";
import { mintSnapshotKey, SNAPSHOT_KEY_STORE_KEY, snapshotKeyOk } from "@/lib/agents/snapshot";
import { parseStoredSlug, SLUG_STORE_KEY } from "@/lib/chat/allow";

export type { CatchEnv } from "./catch";
export { catchOAuth } from "./catch";
export { openSelfStore } from "./self";
export type { SelfStoreOpts } from "./self";
export { openPersonaStore, personaParts } from "./persona";
export type { PersonaStoreOpts } from "./persona";

export type OpenRoomOpts = {
  /** Room slug when the caller already has it. Otherwise the DO's stored slug. */
  slug?: string;
  /** Fold one `log` frame the way a crane `log` line is folded. Also mirrored to console. */
  foldLog: (frame: LogFrame) => void | Promise<void>;
  /** Native catch. Slash reads it off the same sql object passed to `createBrain`. */
  auth?: RoomAuth;
};

type Memo = { generation: string; brain: Brain };

const open = new WeakMap<DurableObjectState, Memo>();

export function dropRoomBrain(ctx: DurableObjectState): void {
  open.delete(ctx);
}

export async function openRoomBrain(ctx: DurableObjectState, env: HouseEnv, opts: OpenRoomOpts): Promise<Brain> {
  const config = parseConfig(await ctx.storage.get(CONFIG_STORE_KEY));
  const stored = parseStoredSlug(await ctx.storage.get(SLUG_STORE_KEY));
  const slug = opts.slug ?? stored ?? "";
  const snap = await ensureSnapshotKey(ctx);
  const map = frameEnv(config, houseEnv(env), snap);
  const store = await openPersonaStore(ctx, opts);
  const parts = personaParts(store);
  const personaText = parts.find((part) => part.name === filePersona)?.text ?? "";
  const generation = JSON.stringify({ slug, persona: parts, env: canonicalEnv(map) });
  const hit = open.get(ctx);
  if (hit && hit.generation === generation) {
    return hit.brain;
  }
  const zone = resolveTimezone(personaText, map.CRON_TZ ?? "").name;
  const clock = systemClock(zone);
  const sql = doSql(ctx.storage.sql);
  if (opts.auth) {
    bindRoomAuth(sql, opts.auth);
  }
  const brain = createBrain({
    sql,
    clock,
    log: makeLogger(roomSink(opts.foldLog), () => clock.now(), slug ? { slug } : {}),
    provider: openaiProvider(providerConfig(map), globalThis.fetch),
    plugins: allPlugins,
    tokens: new AesTokenStore(sql, snap, clock),
    fetch: globalThis.fetch,
    env: map,
    persona: parts,
    slug,
  });
  open.set(ctx, { generation, brain });
  return brain;
}

async function ensureSnapshotKey(ctx: DurableObjectState): Promise<string> {
  const cur = await ctx.storage.get(SNAPSHOT_KEY_STORE_KEY);
  if (typeof cur === "string" && snapshotKeyOk(cur)) {
    return cur;
  }
  const key = mintSnapshotKey();
  await ctx.storage.put(SNAPSHOT_KEY_STORE_KEY, key);
  return key;
}

function providerConfig(env: Record<string, string>): ProviderConfig {
  const effort = (env.LLM_REASONING_EFFORT ?? "").trim();
  return {
    baseUrl: (env.LLM_BASE_URL ?? "").trim(),
    apiKey: (env.LLM_API_KEY ?? "").trim(),
    model: (env.LLM_MODEL ?? "").trim(),
    maxTokens: maxTokensOf(env.LLM_MAX_TOKENS),
    ...(effort ? { reasoningEffort: effort } : {}),
    systemFold: systemFoldOf(env.LLM_SYSTEM_FOLD),
  };
}

function maxTokensOf(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") {
    return 4096;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 4096;
  }
  return Math.floor(n);
}

function systemFoldOf(raw: string | undefined): NonNullable<ProviderConfig["systemFold"]> {
  const fold = (raw ?? "auto").trim().toLowerCase();
  if (fold === "one" || fold === "many" || fold === "auto") {
    return fold;
  }
  return "auto";
}

function roomSink(foldLog: OpenRoomOpts["foldLog"]): LogSink {
  return (record) => {
    consoleSink(record);
    const frame: LogFrame = {
      kind: "log",
      level: record.level,
      message: record.message,
      at: new Date(record.at).toISOString(),
    };
    try {
      const pending = foldLog(frame);
      if (pending) {
        void pending.then(() => undefined, () => undefined);
      }
    } catch {
      // console already has the line; the agents screen misses this one
    }
  };
}

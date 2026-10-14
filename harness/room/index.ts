/**
 * The Agent DO's native harness. Builds `BrainDeps` from the room's storage
 * and memoises one `Brain` per DO instance until config (env, mcp, slug) or the
 * persona rows change, or `dropRoomBrain` runs.
 */
import { createBrain } from "@/harness/agent";
import type { Brain } from "@/harness/core/brain";
import { systemClock } from "@/harness/core/clock";
import { bindWorkerFetch } from "@/harness/core/fetch";
import { consoleSink, makeLogger, type LogSink } from "@/harness/core/log";
import type { ProviderConfig } from "@/harness/core/provider";
import { doSql } from "@/harness/core/sql";
import type { LogFrame } from "@/harness/core/wire";
import { resolveTimezone } from "@/harness/persona";
import { bindRoomAuth, type RoomAuth } from "@/harness/room/authbind";
import { grantedPlugins } from "@/harness/room/grants";
import { filePersona, openPersonaStore, personaParts } from "@/harness/room/persona";
import { allPlugins } from "@/harness/plugins";
import { openaiProvider } from "@/harness/provider";
import { AesTokenStore, mintTokenKey, TOKEN_KEY_STORE_KEY, tokenKeyOk } from "@/harness/tools";
import { applyPlatformGoogle } from "@/lib/agents/platform";
import { canonicalEnv, CONFIG_STORE_KEY, frameEnv, parseConfig } from "@/lib/agents/config";
import { houseEnv, type HouseEnv } from "@/lib/agents/house";
import { parseStoredSlug, SLUG_STORE_KEY } from "@/lib/chat/allow";
import { withImageHandoff } from "@/harness/plugins/image/config";
import { chatLoopbackFetch, withChatMailbox } from "@/harness/room/mailbox";

export type { CatchEnv } from "./catch";
export { catchOAuth } from "./catch";
export { openSelfStore } from "./self";
export type { SelfStoreOpts } from "./self";
export { openPersonaStore, personaParts } from "./persona";
export type { PersonaStoreOpts } from "./persona";

export type OpenRoomOpts = {
  /** Room slug when the caller already has it. Otherwise the DO's stored slug. */
  slug?: string;
  /** Inventory display name when the caller has it; the DO config does not store this yet. */
  name?: string;
  /** Fold one `log` frame the way a crane `log` line is folded. Also mirrored to console. */
  foldLog: (frame: LogFrame) => void | Promise<void>;
  /** Native catch. Slash reads it off the same sql object passed to `createBrain`. */
  auth?: RoomAuth;
  chat?: { origin: string; bearer: string; serve: (req: Request) => Promise<Response> };
  /** Passed to `createBrain`; arms the DO alarm when cron/watch/consolidation due changes. */
  onClock?: (at: number | null) => void | Promise<void>;
  /** Door Google client copied into google / google-health env unless the agent opts out. */
  platformGoogle?: { clientId: string; clientSecret: string };
};

type Memo = { generation: string; harness: Brain };

const open = new WeakMap<DurableObjectState, Memo>();

/** Drop the memoised harness so the next open builds a new registry and plugin set. */
export function dropRoomBrain(ctx: DurableObjectState): void {
  open.delete(ctx);
}

export async function openRoomBrain(ctx: DurableObjectState, env: HouseEnv, opts: OpenRoomOpts): Promise<Brain> {
  const config = parseConfig(await ctx.storage.get(CONFIG_STORE_KEY));
  const stored = parseStoredSlug(await ctx.storage.get(SLUG_STORE_KEY));
  const slug = opts.slug ?? stored ?? "";
  const tokenKey = await ensureTokenKey(ctx);
  let map = frameEnv(config, houseEnv(env));
  if (opts.platformGoogle) {
    map = applyPlatformGoogle(map, config.env, opts.platformGoogle);
  }
  const chat = opts.chat;
  const chatAttach = Boolean(chat && slug && chat.origin.trim() && chat.bearer.trim());
  if (chat && chatAttach) {
    map = withChatMailbox(map, {
      origin: chat.origin,
      slug,
      bearer: chat.bearer,
    });
  }
  map = withImageHandoff(map);
  const store = await openPersonaStore(ctx, opts);
  const parts = personaParts(store);
  const personaText = parts.find((part) => part.name === filePersona)?.text ?? "";
  const generation = JSON.stringify({ slug, persona: parts, env: canonicalEnv(map), mcp: config.mcp });
  const hit = open.get(ctx);
  if (hit && hit.generation === generation) {
    return hit.harness;
  }
  const zone = resolveTimezone(personaText, map.CRON_TZ ?? "").name;
  const clock = systemClock(zone);
  const sql = doSql(ctx.storage.sql);
  if (opts.auth) {
    bindRoomAuth(sql, opts.auth);
  }
  const fetch = chat && chatAttach
    ? chatLoopbackFetch(bindWorkerFetch(), {
        origin: chat.origin,
        slug,
        bearer: chat.bearer,
        apiPrefix: map.CHAT_API_PREFIX,
        serve: chat.serve,
      })
    : bindWorkerFetch();
  const harness = createBrain({
    sql,
    clock,
    log: makeLogger(roomSink(opts.foldLog), () => clock.now(), slug ? { slug } : {}),
    provider: openaiProvider(providerConfig(map), fetch),
    plugins: grantedPlugins(allPlugins, config.mcp),
    tokens: new AesTokenStore(sql, tokenKey, clock),
    fetch,
    env: map,
    persona: parts,
    slug,
    ...((opts.name ?? "").trim() !== "" ? { name: (opts.name ?? "").trim() } : {}),
    ...(opts.onClock ? { onClock: opts.onClock } : {}),
  });
  open.set(ctx, { generation, harness });
  return harness;
}

async function ensureTokenKey(ctx: DurableObjectState): Promise<string> {
  const cur = await ctx.storage.get(TOKEN_KEY_STORE_KEY);
  if (typeof cur === "string" && tokenKeyOk(cur)) {
    return cur;
  }
  const key = mintTokenKey();
  await ctx.storage.put(TOKEN_KEY_STORE_KEY, key);
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
      message: messageWithFields(record.message, record.fields),
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

/** Append field values the message does not already contain. */
function messageWithFields(message: string, fields: Record<string, unknown> | undefined): string {
  if (!fields) {
    return message;
  }
  const extra: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const text = fieldText(value);
    if (!text || message.includes(text)) {
      continue;
    }
    extra.push(`${key}=${text}`);
  }
  if (extra.length === 0) {
    return message;
  }
  return `${message} ${extra.join(" ")}`;
}

function fieldText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return null;
}

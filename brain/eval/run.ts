/**
 * One fixture, one database, one Brain. Seeds the world, feeds the inbound
 * frame (and a second morning when the fixture has `next`), and gathers
 * the outcome from emitted frames, the provider trace, and the stores.
 */
import { DatabaseSync } from "node:sqlite";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink } from "@/brain/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import type { BrainFrame, Inbound, PerfFrame } from "@/brain/core/wire";
import { reactEmoji } from "@/brain/cron/react";
import { parseCronTime } from "@/brain/cron/time";
import { rfc3339 } from "@/brain/memory/time";
import { openaiProvider } from "@/brain/provider";
import { AesTokenStore } from "@/brain/tools/tokens";
import type { Surface } from "@/lib/chat/frame";
import { createEvalBrain } from "./brain";
import { loadLiveCatalog, mergeLiveTools } from "./catalog";
import {
  emptyOutcome,
  morningReply,
  presentReply,
  silentFromReply,
  type EvalOutcome,
} from "./expect";
import {
  EVAL_TZ,
  evalInboundText,
  parseRfc3339,
  type EvalExpect,
  type EvalFixture,
  type EvalTool,
} from "./fixture";
import { cannedPlugins } from "./plugins";
import { EVAL_SESSION, EVAL_SNAPSHOT_KEY, seedFixture } from "./seed";
import { Trace } from "./trace";

export const EVAL_USER = "eval";

/**
 * Inbound id the eval always stamps. The kernel emits a `react` frame only
 * when the human message has an id (the mouth's reaction sink). A missing
 * id is the text fallback: `[react 👍]` goes out as the characters `👍`.
 */
export const EVAL_INBOUND_ID = "eval-inbound";

const TURN_TIMEOUT_MS = 3 * 60 * 1000;

const SURFACES: readonly Surface[] = ["browser", "android", "android_auto", "ios", "carplay"];

export type RunOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  personaPath: string;
};

export type MorningRun = {
  out: EvalOutcome;
  expect: EvalExpect;
  prevLine: string;
  differ: boolean;
  error?: string;
};

export async function runFixture(fx: EvalFixture, opts: RunOptions): Promise<MorningRun[]> {
  const db = new DatabaseSync(":memory:");
  try {
    return await runWorld(nodeSql(db as unknown as NodeDatabase), fx, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{
      out: emptyOutcome(message),
      expect: fx.expect,
      prevLine: "",
      differ: false,
      error: message,
    }];
  } finally {
    db.close();
  }
}

export function inboundFrame(fx: EvalFixture, text: string, atMs: number): Inbound {
  const context: Inbound["context"] = { tz: EVAL_TZ, at: new Date(atMs).toISOString() };
  if (context && isSurface(fx.surface)) {
    context.surface = fx.surface;
  }
  if (fx.input === "spoken" && context) {
    context.input = "spoken";
  } else if (fx.input !== "" && context) {
    // Fixtures also send `typed`. The wire names only `spoken`; the loop reads the string.
    Object.assign(context, { input: fx.input });
  }
  return { kind: "inbound", user_id: EVAL_USER, id: EVAL_INBOUND_ID, text, context };
}

async function runWorld(sql: Sql, fx: EvalFixture, opts: RunOptions): Promise<MorningRun[]> {
  const started = fx.now !== "" ? parseRfc3339(fx.now) : Date.now();
  if (started === null) {
    throw new Error(`${fx.name}: now ${JSON.stringify(fx.now)} is not RFC3339`);
  }
  const clock = fixedClock(started, EVAL_TZ);
  const sink = memorySink();
  const log = makeLogger(sink, () => clock.now());
  const seeded = await seedFixture(sql, clock, log, fx, opts.personaPath);

  const tools = resolveTools(fx);
  const trace = new Trace();
  const plugins = cannedPlugins(tools, trace, started, EVAL_TZ);
  const provider = trace.wrap(openaiProvider({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    model: opts.model,
    timeoutMs: TURN_TIMEOUT_MS,
  }));
  const brain = createEvalBrain({
    sql,
    clock,
    log,
    provider,
    plugins,
    tokens: new AesTokenStore(sql, EVAL_SNAPSHOT_KEY, clock),
    fetch: globalThis.fetch,
    env: {
      MCP_ENABLE_FORCE: fx.force.join(","),
      SNAPSHOT_KEY: EVAL_SNAPSHOT_KEY,
      CRON_TZ: EVAL_TZ,
      LLM_BASE_URL: opts.baseUrl,
      LLM_API_KEY: opts.apiKey,
      LLM_MODEL: opts.model,
    },
    persona: seeded.persona,
    slug: "eval",
  });

  const steps: { at: number; expect: EvalExpect; differ: boolean }[] = [
    { at: started, expect: fx.expect, differ: false },
  ];
  if (fx.next) {
    const at = parseRfc3339(fx.next.now);
    if (at === null) {
      throw new Error(`${fx.name}: next.now ${JSON.stringify(fx.next.now)} is not RFC3339`);
    }
    steps.push({ at, expect: fx.next.expect, differ: fx.next.differentLine });
  }

  const mornings: MorningRun[] = [];
  let prevLine = "";
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) {
      continue;
    }
    clock.set(step.at);
    const mark = trace.mark();
    const frames: BrainFrame[] = [];
    const text = evalInboundText(fx, step.at, EVAL_TZ);
    let error: string | undefined;
    try {
      await withTimeout(TURN_TIMEOUT_MS, () => brain.handleInbound(inboundFrame(fx, text, step.at), (frame) => {
        frames.push(frame);
      }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const slice = trace.since(mark);
    const out = buildOutcome(sql, step.at, fx, text, seeded.memoryIds, seeded.ledgerIds, frames, slice);
    if (error && out.rawReply === "") {
      out.rawReply = error;
    }
    mornings.push({
      out,
      expect: step.expect,
      prevLine,
      differ: step.differ && i > 0,
      ...(error ? { error } : {}),
    });
    prevLine = morningReply(out);
  }
  return mornings;
}

function resolveTools(fx: EvalFixture): EvalTool[] {
  if (fx.toolsFrom.length === 0) {
    return fx.tools;
  }
  return mergeLiveTools(loadLiveCatalog(), fx.toolsFrom, fx.tools);
}

function buildOutcome(
  sql: Sql,
  started: number,
  fx: EvalFixture,
  text: string,
  memoryIds: number[],
  ledgerIds: number[],
  frames: readonly BrainFrame[],
  slice: { calls: EvalOutcome["calls"]; rounds: number; prompt: number; completion: number },
): EvalOutcome {
  let raw = "";
  let frameReaction = "";
  let perfRounds = 0;
  let perfPrompt = 0;
  let perfCompletion = 0;
  for (const frame of frames) {
    if ((frame.kind === "reply" || frame.kind === "push") && frame.text) {
      raw = frame.text;
    }
    if (frame.kind === "react" && frame.text) {
      frameReaction = frame.text;
    }
    if (isPerf(frame)) {
      perfPrompt += frame.tokens.prompt;
      perfCompletion += frame.tokens.completion;
      if (typeof frame.iterations === "number") {
        perfRounds = frame.iterations;
      }
    }
  }
  const reaction = frameReaction !== "" ? frameReaction : reactEmoji(raw);
  const reply = presentReply(raw);
  const usedModel = slice.rounds > 0;
  const rows = liveMemory(sql, started);
  return {
    calls: slice.calls,
    reply,
    rawReply: raw,
    reaction,
    waiting: readWaiting(sql),
    silent: silentFromReply(reply, raw, reaction),
    jobs: readJobs(sql),
    started,
    rounds: usedModel ? slice.rounds : perfRounds,
    promptTokens: usedModel ? slice.prompt : perfPrompt,
    completionTokens: usedModel ? slice.completion : perfCompletion,
    given: evalGiven(fx, text),
    ledgerIds,
    memoryIds,
    memoryHas: (kind, subject) => rows.some((row) => row.kind === kind && row.subject === subject),
  };
}

export function evalGiven(fx: EvalFixture, text: string): string {
  const lines = [text, fx.self];
  for (const row of fx.memory) {
    lines.push(row.content);
  }
  for (const turn of fx.history) {
    lines.push(turn.text);
  }
  return `${lines.join("\n")}\n`;
}

function liveMemory(sql: Sql, nowMs: number): { kind: string; subject: string }[] {
  try {
    return sql.exec<{ kind: string; subject: string }>(
      `SELECT kind, subject FROM memory
       WHERE superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      rfc3339(nowMs),
    );
  } catch {
    return [];
  }
}

function readWaiting(sql: Sql): boolean {
  try {
    const rows = sql.exec<{ id: string }>(
      "SELECT id FROM session WHERE id = ? AND waiting_for_reply != 0",
      EVAL_SESSION,
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

function readJobs(sql: Sql): { kind: string; nextRunAt: number }[] {
  try {
    const rows = sql.exec<{ kind: string; next_run_at: string }>(
      "SELECT kind, next_run_at FROM cron_job WHERE enabled != 0",
    );
    const jobs: { kind: string; nextRunAt: number }[] = [];
    for (const row of rows) {
      try {
        jobs.push({ kind: row.kind, nextRunAt: parseCronTime(row.next_run_at) });
      } catch {
        // A row the store would not parse is not a reminder the check can use.
      }
    }
    return jobs;
  } catch {
    return [];
  }
}

function isPerf(frame: BrainFrame): frame is PerfFrame {
  return frame.kind === "perf" && "tokens" in frame && frame.tokens !== undefined;
}

function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

function withTimeout<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("eval turn timed out"));
    }, ms);
  });
  return Promise.race([run(), timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

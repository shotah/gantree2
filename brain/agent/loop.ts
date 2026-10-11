/**
 * One model turn: refresh tools, call the provider, run a parallel batch,
 * nudge theater / deferral / cron-live misses once, then land. No timers.
 */
import { addUsage, usagePresent } from "@/brain/provider/usage";
import { isEmptyContent, ProviderError } from "@/brain/provider/errors";
import type { ChatProvider, ChatResult, Message, ProviderToolDef, ToolCall, Usage } from "@/brain/core/provider";
import type { ToolCallResult } from "@/brain/tools/registry";
import type { Registry } from "@/brain/tools/registry";
import type { EnableStore } from "@/brain/tools/enable";
import { collapseOldToolResults } from "./bound";
import type { DraftStream } from "./frames";
import {
  claimsToolSuccess,
  cronJobImpliesLiveTools,
  defersPendingWork,
  estMessageTokens,
  firstLine,
  isToolsFooterOnly,
  lastUserContent,
  promisesToolCall,
  resultGenEst,
  salvageToolCall,
  schemaTokens,
  withCronToolFooter,
  clipChars,
} from "./judgment";
import {
  BUDGET_EXHAUSTED_REPLY,
  budgetExhaustedNote,
  budgetWarnNote,
  CRON_LIVE_NUDGE,
  CRON_SKIPPED_LIVE_REPLY,
  DEFERRAL_NUDGE,
  PLANNER_NUDGE,
  SOURCE_CRON,
  STALL_GIVE_UP,
  THEATER_CUE_MAX_CHARS,
  THEATER_NUDGE,
  THINKING_NUDGE_PREFIX,
  TOOL_TRACE_COMPACT,
  TOOL_TRACE_FULL,
  TOOL_TRACE_OFF,
  TOOLS_FOOTER_NUDGE,
} from "./notes";
import { isDailyPlannerTurn } from "@/brain/cron/planner";
import { isSilentReply } from "@/brain/cron/silent";
import { stripWaitTokensLive } from "@/brain/cron/wait";
import type { ToolStats, TurnStats } from "./perf";

const ZERO: Usage = { prompt: 0, completion: 0 };

export class TurnCancelled extends Error {
  readonly stats: TurnStats;
  constructor(stats: TurnStats) {
    super("cancelled");
    this.name = "TurnCancelled";
    this.stats = stats;
  }
}

export class TurnFailed extends Error {
  readonly stats: TurnStats;
  constructor(message: string, stats: TurnStats) {
    super(message);
    this.name = "TurnFailed";
    this.stats = stats;
  }
}

export type LoopInput = {
  provider: ChatProvider;
  registry: Registry;
  enable: EnableStore;
  sessionId: string;
  userId: string;
  messages: Message[];
  tools: ProviderToolDef[];
  stableEnd: number;
  hydration: number;
  schemas: number;
  source: string;
  /** Examples pings: never send schemas. */
  omitTools: boolean;
  maxIters: number;
  toolTrace: string;
  streamReplies: boolean;
  stream: DraftStream | null;
  signal: AbortSignal;
  now: () => number;
  model: string;
  cold: boolean;
  toolStats: ToolStats;
  geo?: { lat: number; lon: number; accuracy?: number };
};

export type LoopResult = {
  /** Model reply, cron footer included when the audit line applies. */
  reply: string;
  photos: string[];
  called: string[];
  stats: TurnStats;
};

export async function runLoop(input: LoopInput): Promise<LoopResult> {
  const messages = input.messages.map((m) => ({ ...m }));
  const called: string[] = [];
  const photos: string[] = [];
  let toolDefs = input.omitTools ? [] : input.tools.slice();
  let schemas = input.schemas;
  let forceNames: string[] = [];
  let nudged = false;
  let sawTools = false;
  let budgetWarned = false;
  let lastNarration = "";
  let usedLanding = false;
  let iters = 0;
  let recoveries = 0;
  let toolCalls = 0;
  let maxBatch = 0;
  let promptEst = 0;
  let genEst = 0;
  let modelMs = 0;
  let toolMs = 0;
  let volatileEst = 0;
  let firstTokenMs = 0;
  let usage: Usage = { ...ZERO };
  let usageRounds = 0;
  let lastModel = "";
  let lastFinish = "";
  let lastTier = "";
  const started = input.now();

  const stats = (outcome: string): TurnStats => {
    const total = Math.max(0, input.now() - started);
    return {
      outcome,
      iterations: iters,
      toolCalls,
      maxBatch,
      recoveries,
      promptEst,
      genEst,
      modelMs,
      toolMs,
      totalMs: total,
      hydration: input.hydration,
      volatileEst,
      firstTokenMs,
      model: lastModel,
      finishReason: lastFinish,
      serviceTier: lastTier,
      usage,
      usageRounds,
      cold: input.cold,
    };
  };

  const finish = (reply: string, hint = ""): LoopResult => ({
    reply: applyFooter(reply),
    photos,
    called,
    stats: stats(hint !== "" ? hint : usedLanding ? "landing" : "ok"),
  });

  const applyFooter = (reply: string): string => {
    if (input.source !== SOURCE_CRON || reply === "" || isSilentReply(reply)) return reply;
    if (called.length === 0 && !cronJobImpliesLiveTools(lastUserContent(messages))) return reply;
    return withCronToolFooter(reply, called);
  };

  const refresh = (): void => {
    if (input.omitTools) {
      toolDefs = [];
      schemas = 0;
      return;
    }
    const enabled = input.enable.list(input.sessionId).map((row) => row.prefix);
    toolDefs = input.registry.list(enabled).map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    }));
    schemas = schemaTokens(toolDefs);
  };

  try {
    for (let iter = 0; iter <= input.maxIters; iter += 1) {
      if (input.signal.aborted) throw new TurnCancelled(stats("cancel"));
      const final = iter === input.maxIters;
      iters = iter + 1;
      if (final) usedLanding = true;
      if (!final) refresh();
      let bounded = collapseOldToolResults(messages);
      let names = forceNames;
      if (final) {
        names = [];
        bounded = [...bounded, { role: "system", content: budgetExhaustedNote(input.maxIters) }];
      }
      const constrained = names.length > 0;
      if (constrained) {
        recoveries += 1;
        input.toolStats.constrainedRetry += 1;
      }
      forceNames = [];
      const promptTokens = estMessageTokens(bounded) + schemas;
      const volatileTokens = estMessageTokens(bounded.slice(Math.min(input.stableEnd, bounded.length)));
      const streamed = input.streamReplies && input.stream != null && !constrained;
      const callStart = input.now();
      let sawToken = false;
      let res: ChatResult;
      try {
        const req = {
          messages: bounded,
          tools: final || toolDefs.length === 0 ? undefined : toolDefs,
          forceToolNames: names.length > 0 ? names : undefined,
          signal: input.signal,
        };
        if (streamed && input.stream) {
          const stream = input.stream;
          res = await input.provider.completeStream(req, (content) => {
            if (!sawToken && content !== "") {
              sawToken = true;
              if (iter === 0) firstTokenMs = Math.max(0, input.now() - callStart);
            }
            stream.update(stripWaitTokensLive(content));
          });
        } else {
          res = await input.provider.complete(req);
        }
      } catch (err) {
        modelMs += Math.max(0, input.now() - callStart);
        if (input.signal.aborted || isAbort(err)) throw new TurnCancelled(stats("cancel"));
        if (isEmptyContent(err) && lastNarration.trim() !== "") return finish(lastNarration);
        const message = err instanceof Error ? err.message : String(err);
        throw new TurnFailed(message, stats("error"));
      }
      modelMs += Math.max(0, input.now() - callStart);
      promptEst += promptTokens;
      genEst += resultGenEst(res.content, res.thinking ?? "", res.toolCalls);
      if (usagePresent(res.usage)) {
        usage = addUsage(usage, res.usage);
        usageRounds += 1;
      }
      if (res.model) lastModel = res.model;
      if (res.finishReason) lastFinish = res.finishReason;
      if (res.serviceTier) lastTier = res.serviceTier;
      if (iter === 0) volatileEst = volatileTokens;

      let calls = res.toolCalls;
      let content = res.content;
      if (calls.length === 0 && !final && !input.omitTools) {
        const salvaged = salvageToolCall(content, toolDefs, messages);
        if (salvaged) {
          calls = [salvaged];
          content = "";
          recoveries += 1;
        }
      }
      if (content.trim() !== "" && !isToolsFooterOnly(content)) lastNarration = content.trim();

      if (calls.length === 0) {
        if (content === "") {
          const think = (res.thinking ?? "").trim();
          if (think !== "") {
            if (sawTools) return finish(think);
            if (!nudged) {
              nudged = true;
              recoveries += 1;
              messages.push({ role: "system", content: THINKING_NUDGE_PREFIX + clipChars(res.thinking ?? "", 600) });
              continue;
            }
            throw new TurnFailed(`agent: model stalled after thinking (no reply, no tool call; thinking_chars=${String(think.length)})`, stats("error"));
          }
          throw new TurnFailed("agent: empty model reply", stats("error"));
        }
        if (isToolsFooterOnly(content)) {
          if (streamed) input.stream?.discard();
          if (!nudged && !final) {
            nudged = true;
            recoveries += 1;
            messages.push({ role: "assistant", content });
            messages.push({ role: "user", content: TOOLS_FOOTER_NUDGE });
            continue;
          }
          if (lastNarration.trim() !== "") return finish(lastNarration);
          throw new TurnFailed("agent: empty model reply", stats("error"));
        }
        let preTool = !sawTools && (promisesToolCall(content, res.thinking ?? "") || claimsToolSuccess(content));
        if (preTool && content.length >= THEATER_CUE_MAX_CHARS) preTool = false;
        const userContent = lastUserContent(messages);
        const plannerTurn = isDailyPlannerTurn(userContent);
        const cronSkipped = !sawTools && input.source === SOURCE_CRON && toolDefs.length > 0
          && (plannerTurn || cronJobImpliesLiveTools(userContent));
        const deferral = sawTools && defersPendingWork(content);
        if ((preTool || deferral || cronSkipped) && !nudged) {
          nudged = true;
          recoveries += 1;
          messages.push({ role: "assistant", content });
          let nudge = THEATER_NUDGE;
          if (deferral) nudge = DEFERRAL_NUDGE;
          else if (plannerTurn) nudge = PLANNER_NUDGE;
          else if (cronSkipped) nudge = CRON_LIVE_NUDGE;
          messages.push({ role: "user", content: nudge });
          continue;
        }
        if (deferral && nudged) return finish(STALL_GIVE_UP, "stall");
        if (cronSkipped && nudged) {
          return finish(plannerTurn ? "[silent]" : CRON_SKIPPED_LIVE_REPLY, "refuse");
        }
        return finish(content);
      }

      if (input.omitTools) return finish(content);
      if (final) {
        input.toolStats.budgetRefused += calls.length;
        const prose = content.trim();
        const reply = prose === "" ? BUDGET_EXHAUSTED_REPLY : `${prose}\n\n${BUDGET_EXHAUSTED_REPLY}`;
        return finish(reply, "budget");
      }

      messages.push({ role: "assistant", content, toolCalls: calls });
      if (input.stream && !streamed && input.toolTrace !== TOOL_TRACE_OFF) {
        const reason = firstLine(content);
        if (reason !== "") input.stream.progress(reason);
      }
      const round = await runBatch(input, calls, input.stream != null);
      toolMs += round.wall;
      if (round.results.length > 0) {
        toolCalls += round.results.length;
        if (round.results.length > maxBatch) maxBatch = round.results.length;
      }
      if (round.forceNames.length > 0) forceNames = round.forceNames;
      for (const row of round.results) {
        sawTools = true;
        called.push(row.name);
        messages.push({ role: "tool", content: row.text, toolCallId: row.id });
        for (const url of row.images) photos.push(url);
      }
      const warnAt = Math.trunc(input.maxIters * 7 / 10);
      if (!budgetWarned && iters >= warnAt && input.maxIters - iters >= 1) {
        budgetWarned = true;
        messages.push({ role: "system", content: budgetWarnNote(iters, input.maxIters) });
      }
    }
  } catch (err) {
    if (err instanceof TurnCancelled || err instanceof TurnFailed) throw err;
    if (input.signal.aborted || isAbort(err)) throw new TurnCancelled(stats("cancel"));
    const message = err instanceof Error ? err.message : String(err);
    throw new TurnFailed(message, stats("error"));
  }
  throw new TurnFailed(`agent: exceeded TOOL_MAX_ITERATIONS (${String(input.maxIters)})`, stats("error"));
}

type RoundRow = { name: string; id: string; text: string; images: string[]; failed: boolean };

async function runBatch(
  input: LoopInput,
  calls: readonly ToolCall[],
  progress: boolean,
): Promise<{ results: RoundRow[]; forceNames: string[]; wall: number }> {
  if (input.toolTrace === TOOL_TRACE_COMPACT && progress && input.stream) {
    input.stream.progress("Making Calls:");
  }
  const start = input.now();
  const settled = await Promise.all(calls.map(async (call) => execCall(input, call, progress)));
  const wall = Math.max(0, input.now() - start);
  const results: RoundRow[] = [];
  let forceNames: string[] = [];
  for (const row of settled) {
    if (row.candidates.length > 0 && forceNames.length === 0) {
      forceNames = row.candidates;
      input.toolStats.unknownTool += 1;
    }
    results.push(row);
  }
  return { results, forceNames, wall };
}

async function execCall(input: LoopInput, call: ToolCall, progress: boolean): Promise<RoundRow & { candidates: string[] }> {
  if (input.toolTrace === TOOL_TRACE_FULL && progress && input.stream) {
    input.stream.progress(`→ ${call.name}`);
  }
  const started = input.now();
  let result: ToolCallResult;
  try {
    result = await input.registry.call(call.name, objectArgs(call.arguments), {
      userId: input.userId,
      sessionId: input.sessionId,
      geo: input.geo,
      signal: input.signal,
    });
  } catch (err) {
    if (input.signal.aborted || isAbort(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    result = {
      content: [{ type: "text", text: message.startsWith("tool error") ? message : `tool error: ${message}` }],
      isError: true,
    };
  }
  const ms = Math.max(0, input.now() - started);
  const failed = result.isError === true;
  input.toolStats.note(call.name, ms, failed);
  const text = toolText(result);
  if (progress && input.stream) {
    if (input.toolTrace === TOOL_TRACE_FULL) {
      const mark = failed ? `✗ failed · ${shortDuration(ms)}` : `✓ ${shortDuration(ms)} · ${shortChars(text.length)}`;
      input.stream.progress(mark);
    } else if (input.toolTrace === TOOL_TRACE_COMPACT) {
      input.stream.progress(failed ? "✗" : "✓");
    }
  }
  return {
    name: call.name,
    id: call.id,
    text,
    images: result.images ?? [],
    failed,
    candidates: result.candidates ?? [],
  };
}

function toolText(result: ToolCallResult): string {
  const parts: string[] = [];
  for (const part of result.content) {
    if (part.type === "text" && part.text.trim() !== "") parts.push(part.text);
  }
  return parts.join("\n");
}

function objectArgs(raw: string): Record<string, unknown> {
  const text = raw.trim() === "" ? "{}" : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) out[key] = value;
  return out;
}

function shortDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const tenths = Math.trunc(ms / 100) / 10;
  return `${tenths.toFixed(1)}s`;
}

function shortChars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k chars`;
  return `${String(n)} chars`;
}

function isAbort(err: unknown): boolean {
  if (err instanceof ProviderError && err.kind === "aborted") return true;
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}

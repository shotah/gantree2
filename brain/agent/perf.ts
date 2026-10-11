/**
 * `/perf` ring and `/toolstats` counters. Same numbers the Go agent printed;
 * nothing here starts a timer.
 */
import { usagePresent } from "@/brain/provider/usage";
import type { Usage } from "@/brain/core/provider";
import { formatUptime } from "./slash";
import type { PerfInput } from "./frames";

const RING = 12;
const TOP = 15;

export type TurnStats = {
  outcome: string;
  iterations: number;
  toolCalls: number;
  maxBatch: number;
  recoveries: number;
  promptEst: number;
  genEst: number;
  modelMs: number;
  toolMs: number;
  totalMs: number;
  hydration: number;
  volatileEst: number;
  firstTokenMs: number;
  model: string;
  finishReason: string;
  serviceTier: string;
  usage: Usage;
  usageRounds: number;
  cold: boolean;
};

type Row = TurnStats & { seq: number; when: number; source: string };

export class PerfRing {
  private readonly buf: (Row | undefined)[] = new Array<Row | undefined>(RING);
  private len = 0;
  private next = 0;
  private total = 0;

  constructor(private readonly startedAt: number) {}

  append(when: number, source: string, stats: TurnStats): void {
    this.total += 1;
    const row: Row = { ...stats, seq: this.total, when, source };
    this.buf[this.next] = row;
    this.next = (this.next + 1) % RING;
    if (this.len < RING) this.len += 1;
  }

  turnCount(): number {
    return this.total;
  }

  format(now: number, zone: string): string {
    if (this.len === 0) return "no turns yet";
    const lines = [`perf — last ${String(this.len)} turns (uptime ${formatUptime(now - this.startedAt)})`];
    for (let i = 0; i < this.len; i += 1) {
      const row = this.buf[(this.next - 1 - i + RING) % RING];
      if (!row) continue;
      lines.push(lineOf(row, zone));
    }
    return lines.join("\n");
  }
}

export function perfInput(
  sessionId: string,
  source: string,
  userId: string,
  modelFallback: string,
  stats: TurnStats,
): PerfInput {
  const model = stats.model !== "" ? stats.model : modelFallback;
  const toolsPerInv = stats.iterations > 0 ? stats.toolCalls / stats.iterations : 0;
  const frame: PerfInput = {
    turn: sessionId,
    source,
    outcome: stats.outcome,
    session_id: sessionId,
    iterations: stats.iterations,
    tool_calls: stats.toolCalls,
    max_batch: stats.maxBatch,
    recoveries: stats.recoveries,
    tools_per_inv: toolsPerInv,
    prompt_est_tokens: stats.promptEst,
    gen_est_tokens: stats.genEst,
    model_ms: stats.modelMs,
    tool_ms: stats.toolMs,
    total_ms: stats.totalMs,
    duration_ms: stats.totalMs,
    hydration_est_tokens: stats.hydration,
    tokens: { prompt: stats.usage.prompt, completion: stats.usage.completion },
  };
  if (source === "user" || source === "reaction" || userId !== "") frame.user_id = userId;
  if (model !== "") frame.model = model;
  if (stats.finishReason !== "") frame.finish_reason = stats.finishReason;
  if (stats.serviceTier !== "") frame.service_tier = stats.serviceTier;
  if (usagePresent(stats.usage)) {
    frame.total_tokens = stats.usage.total ?? stats.usage.prompt + stats.usage.completion;
    frame.usage_rounds = stats.usageRounds;
    if (stats.usage.cached) frame.cached_tokens = stats.usage.cached;
    if (stats.usage.cacheWrite) frame.cache_write_tokens = stats.usage.cacheWrite;
    if (stats.usage.reasoning) frame.reasoning_tokens = stats.usage.reasoning;
    if (stats.usage.promptAudio) frame.prompt_audio_tokens = stats.usage.promptAudio;
    if (stats.usage.completionAudio) frame.completion_audio_tokens = stats.usage.completionAudio;
    if (stats.usage.acceptedPrediction) frame.accepted_prediction_tokens = stats.usage.acceptedPrediction;
    if (stats.usage.rejectedPrediction) frame.rejected_prediction_tokens = stats.usage.rejectedPrediction;
  }
  return frame;
}

type ToolRow = { name: string; calls: number; errors: number; totalMs: number; maxMs: number };

export class ToolStats {
  private readonly byName = new Map<string, ToolRow>();
  private totalCalls = 0;
  prefixAlias = 0;
  constrainedRetry = 0;
  unknownTool = 0;
  budgetRefused = 0;

  note(name: string, ms: number, failed: boolean): void {
    this.totalCalls += 1;
    const row = this.byName.get(name) ?? { name, calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
    row.calls += 1;
    if (failed) row.errors += 1;
    row.totalMs += ms;
    if (ms > row.maxMs) row.maxMs = ms;
    this.byName.set(name, row);
  }

  format(uptimeMs: number): string {
    if (this.totalCalls === 0 && this.prefixAlias === 0 && this.constrainedRetry === 0 && this.unknownTool === 0) {
      return "no tool calls yet";
    }
    const lines = [`tool stats — ${String(this.totalCalls)} calls since boot (${formatUptime(uptimeMs)})`];
    const rows = [...this.byName.values()].sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1));
    for (const row of rows.slice(0, TOP)) {
      const ok = Math.max(0, row.calls - row.errors);
      const avg = row.calls > 0 ? Math.trunc(row.totalMs / row.calls) : 0;
      lines.push(`${pad(row.name, 24)} ${String(row.calls)} calls  ✓${String(ok)} ✗${String(row.errors)}  avg ${formatSec(avg)}  max ${formatSec(row.maxMs)}`);
    }
    let tail = `repairs: prefix_alias=${String(this.prefixAlias)}  constrained_retry=${String(this.constrainedRetry)}  unknown_tool=${String(this.unknownTool)}`;
    if (this.budgetRefused > 0) tail += `  budget_refused=${String(this.budgetRefused)}`;
    lines.push(tail);
    return lines.join("\n");
  }
}

export function zeroStats(model: string): TurnStats {
  return {
    outcome: "error",
    iterations: 0,
    toolCalls: 0,
    maxBatch: 0,
    recoveries: 0,
    promptEst: 0,
    genEst: 0,
    modelMs: 0,
    toolMs: 0,
    totalMs: 0,
    hydration: 0,
    volatileEst: 0,
    firstTokenMs: 0,
    model,
    finishReason: "",
    serviceTier: "",
    usage: { prompt: 0, completion: 0 },
    usageRounds: 0,
    cold: false,
  };
}

function lineOf(rec: Row, zone: string): string {
  const src = rec.source === "" ? "user" : rec.source;
  let line = `#${String(rec.seq)} ${clock(rec.when, zone)}  ${src}  total=${formatSec(rec.totalMs)} model=${formatSec(rec.modelMs)} tool=${formatSec(rec.toolMs)} iters=${String(rec.iterations)} tools=${String(rec.toolCalls)} batch=${String(rec.maxBatch)} rec=${String(rec.recoveries)} prompt≈${formatK(rec.promptEst)} gen≈${formatK(rec.genEst)} first_token=${formatSec(rec.firstTokenMs)} volatile≈${formatK(rec.volatileEst)}`;
  if (rec.outcome !== "" && rec.outcome !== "ok") line += `  ${rec.outcome}`;
  if (rec.cold) line += "  ← cold";
  return line;
}

function clock(ms: number, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return fmt.format(new Date(ms));
}

function formatSec(ms: number): string {
  if (ms <= 0) return "0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatK(n: number): string {
  const v = n < 0 ? 0 : n;
  return `${(v / 1000).toFixed(1)}k`;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

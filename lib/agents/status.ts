/**
 * Fold harness frames into the Agent DO. `status`, `perf`, and `log` stay
 * here — they are never fanned out to phones. `harnessKind` is that filter.
 * Liveness is the harness the DO opened, not a container socket.
 */
import { PACKAGE_VERSION } from "@/app/lib/release";
import {
  AGENT_SLUG,
  type AgentStatus,
  type BrainState,
  type LogLine,
  type LogPage,
  type PluginStatus,
} from "@/lib/agents/types";
import type { SampleInput } from "@/lib/door/settingsStore";

export const STATUS_STORE_KEY = "agent.status";
export const LOG_STORE_KEY = "agent.log";
export const LOG_CAP = 500;
export const LOG_PAGE = 200;

const HARNESS_KINDS = new Set(["status", "perf", "log"]);
/** slog prints `ERROR`; `foldLog` lowercases. The others are what a plugin's own logger might say. */
const ERROR_LEVELS = new Set(["error", "fatal", "panic"]);
const LIST_MAX = 128;
const MESSAGE_RUNES = 2000;

export type LogRing = { seq: number; lines: LogLine[] };

export type HarnessFold = {
  status: AgentStatus;
  log: LogRing;
  samples: SampleInput[];
};

const BRAIN_STATES = new Set<BrainState>(["ready", "needs_keys", "error", "starting"]);
const KEY_REASONS = new Set(["no_key", "no_oauth"]);

export function emptyStatus(): AgentStatus {
  return {
    state: "starting",
    since: null,
    version: PACKAGE_VERSION,
    lastTurnAt: null,
    lastTurn: null,
    plugins: [],
    published: [],
    skipped: [],
    lastError: null,
    perf: { turns: 0, prompt: 0, completion: 0, errors: 0 },
  };
}

function isBrainState(value: unknown): value is BrainState {
  return typeof value === "string" && BRAIN_STATES.has(value as BrainState);
}

function perfOf(raw: unknown): AgentStatus["perf"] | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const counts = raw as Record<string, unknown>;
  if (
    typeof counts.turns !== "number"
    || typeof counts.prompt !== "number"
    || typeof counts.completion !== "number"
    || typeof counts.errors !== "number"
  ) {
    return null;
  }
  return {
    turns: counts.turns,
    prompt: counts.prompt,
    completion: counts.completion,
    errors: counts.errors,
  };
}

function pluginOf(value: unknown): PluginStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as { name?: unknown; state?: unknown; reason?: unknown };
  if (typeof row.name !== "string" || !row.name.trim()) {
    return null;
  }
  if (row.state !== "ready" && row.state !== "skipped") {
    return null;
  }
  const name = row.name.trim().slice(0, 128);
  if (row.state === "ready") {
    return { name, state: "ready" };
  }
  const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, 64) : "";
  return reason ? { name, state: "skipped", reason } : { name, state: "skipped" };
}

/** Ready names first, then skips, in the order the registry published them. */
export function pluginsFromLists(
  published: readonly string[],
  skipped: readonly { name: string; reason: string }[],
): PluginStatus[] {
  const plugins: PluginStatus[] = [];
  for (const name of published) {
    if (!name || plugins.length >= LIST_MAX) {
      continue;
    }
    plugins.push({ name, state: "ready" });
  }
  for (const row of skipped) {
    if (!row.name || plugins.length >= LIST_MAX) {
      continue;
    }
    plugins.push(row.reason
      ? { name: row.name, state: "skipped", reason: row.reason }
      : { name: row.name, state: "skipped" });
  }
  return plugins;
}

export function listsFromPlugins(plugins: readonly PluginStatus[]): {
  published: string[];
  skipped: { name: string; reason: string }[];
} {
  const published: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const plugin of plugins) {
    if (plugin.state === "ready") {
      published.push(plugin.name);
    } else {
      skipped.push({ name: plugin.name, reason: plugin.reason ?? "" });
    }
  }
  return { published, skipped };
}

/**
 * Boot outcome. A disabled plugin is off on purpose. `no_key` and `no_oauth`
 * still need a credential. Any other skip is a load failure.
 */
export function stateFromPlugins(plugins: readonly PluginStatus[]): Exclude<BrainState, "starting"> {
  let needs = false;
  for (const plugin of plugins) {
    if (plugin.state !== "skipped") {
      continue;
    }
    const reason = plugin.reason ?? "";
    if (reason === "disabled") {
      continue;
    }
    if (KEY_REASONS.has(reason)) {
      needs = true;
      continue;
    }
    return "error";
  }
  return needs ? "needs_keys" : "ready";
}

/** Screen word. A booted harness is running; an empty or failed row has not started. */
export function statusLabel(state: BrainState | null | undefined): "running" | "not started" {
  if (state === "ready" || state === "needs_keys") {
    return "running";
  }
  return "not started";
}

export function emptyLog(): LogRing {
  return { seq: 0, lines: [] };
}

function isLastError(value: unknown): value is { message: string; at: string } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as { message?: unknown; at?: unknown };
  return typeof row.message === "string" && typeof row.at === "string";
}

function turnOf(row: Record<string, unknown>): number | null | "bad" {
  const raw = row.lastTurnAt !== undefined ? row.lastTurnAt : row.lastTurn;
  if (raw == null) {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return "bad";
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  const turn = turnOf(row);
  return isBrainState(row.state)
    && (row.since === null || typeof row.since === "number")
    && Array.isArray(row.plugins)
    && turn !== "bad"
    && (row.lastError == null || isLastError(row.lastError))
    && perfOf(row.perf) !== null;
}

export function parseStatus(raw: unknown): AgentStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyStatus();
  }
  const row = raw as Record<string, unknown>;
  const perf = perfOf(row.perf);
  if (!perf) {
    return emptyStatus();
  }
  if (row.lastError != null && !isLastError(row.lastError)) {
    return emptyStatus();
  }
  const legacy = row.harness === "connected" || row.harness === "disconnected";
  if (!isBrainState(row.state) && !legacy && !Array.isArray(row.plugins) && !Array.isArray(row.published)) {
    return emptyStatus();
  }
  const turn = turnOf(row);
  if (turn === "bad") {
    return emptyStatus();
  }
  let plugins: PluginStatus[];
  if (Array.isArray(row.plugins)) {
    plugins = [];
    for (const item of row.plugins) {
      if (plugins.length >= LIST_MAX) {
        break;
      }
      const plugin = pluginOf(item);
      if (plugin) {
        plugins.push(plugin);
      }
    }
  } else {
    plugins = pluginsFromLists(asNameList(row.published) ?? [], asSkipped(row.skipped) ?? []);
  }
  let state: BrainState = "starting";
  if (isBrainState(row.state)) {
    state = row.state;
  } else if (row.harness === "connected" || plugins.length > 0) {
    state = stateFromPlugins(plugins);
  }
  const lists = listsFromPlugins(plugins);
  return {
    state,
    since: typeof row.since === "number" && Number.isFinite(row.since) ? row.since : null,
    version: PACKAGE_VERSION,
    lastTurnAt: turn,
    lastTurn: turn,
    plugins,
    published: lists.published,
    skipped: lists.skipped,
    lastError: isLastError(row.lastError) ? { message: row.lastError.message, at: row.lastError.at } : null,
    perf,
  };
}

function isLogLine(value: unknown): value is LogLine {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as LogLine;
  return typeof row.seq === "number"
    && Number.isSafeInteger(row.seq)
    && typeof row.at === "string"
    && typeof row.level === "string"
    && typeof row.message === "string";
}

export function parseLog(raw: unknown): LogRing {
  if (!raw || typeof raw !== "object") {
    return emptyLog();
  }
  const seq = (raw as { seq?: unknown }).seq;
  const lines = (raw as { lines?: unknown }).lines;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || !Array.isArray(lines)) {
    return emptyLog();
  }
  const kept: LogLine[] = [];
  for (const line of lines) {
    if (!isLogLine(line)) {
      continue;
    }
    const next: LogLine = { seq: line.seq, at: line.at, level: line.level, message: line.message };
    if (typeof line.dropped === "number" && Number.isFinite(line.dropped)) {
      next.dropped = line.dropped;
    }
    kept.push(next);
  }
  return { seq, lines: kept.slice(-LOG_CAP) };
}

/** A harness open. Clears the last error and stamps `since`. Perf stays; the stored row outlives the isolate. */
export function noteBrainOpen(status: AgentStatus, now: number): AgentStatus {
  return {
    ...status,
    since: now,
    version: PACKAGE_VERSION,
    lastError: null,
  };
}

function textOf(message: string | ArrayBuffer): string {
  return typeof message === "string" ? message : new TextDecoder().decode(message);
}

/** Kind when this socket payload is a harness frame the phones must not see. */
export function harnessKind(message: string | ArrayBuffer): string | null {
  const text = textOf(message);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const kind = (parsed as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !HARNESS_KINDS.has(kind)) {
      return null;
    }
    return kind;
  } catch {
    return null;
  }
}

function asNameList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= LIST_MAX) {
      break;
    }
    if (typeof item !== "string") {
      continue;
    }
    const name = item.trim();
    if (!name) {
      continue;
    }
    out.push(name.slice(0, 128));
  }
  return out;
}

function asSkipped(raw: unknown): { name: string; reason: string }[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: { name: string; reason: string }[] = [];
  for (const item of raw) {
    if (out.length >= LIST_MAX) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const name = (item as { name?: unknown }).name;
    const reason = (item as { reason?: unknown }).reason;
    if (typeof name !== "string" || !name.trim()) {
      continue;
    }
    out.push({
      name: name.trim().slice(0, 128),
      reason: typeof reason === "string" ? reason.trim().slice(0, 64) : "",
    });
  }
  return out;
}

function foldStatus(status: AgentStatus, raw: object): AgentStatus {
  const published = asNameList((raw as { published?: unknown }).published);
  const skipped = asSkipped((raw as { skipped?: unknown }).skipped);
  if (!published && !skipped) {
    return status;
  }
  const nextPublished = published ?? status.published;
  const nextSkipped = skipped ?? status.skipped;
  const plugins = pluginsFromLists(nextPublished, nextSkipped);
  return {
    ...status,
    state: stateFromPlugins(plugins),
    version: PACKAGE_VERSION,
    plugins,
    published: nextPublished,
    skipped: nextSkipped,
  };
}

function tokenCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

function addCount(cur: number, add: number): number {
  const next = cur + add;
  if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER) {
    return Number.MAX_SAFE_INTEGER;
  }
  return next;
}

function foldPerf(status: AgentStatus, log: LogRing, raw: object, now: number, slug: string | null): HarnessFold {
  const tokens = (raw as { tokens?: unknown }).tokens;
  const tokenRow = tokens && typeof tokens === "object" ? tokens as { prompt?: unknown; completion?: unknown } : {};
  const prompt = tokenCount(tokenRow.prompt);
  const completion = tokenCount(tokenRow.completion);
  const outcome = (raw as { outcome?: unknown }).outcome;
  const next: AgentStatus = {
    ...status,
    version: PACKAGE_VERSION,
    lastTurnAt: now,
    lastTurn: now,
    perf: {
      turns: addCount(status.perf.turns, 1),
      prompt: addCount(status.perf.prompt, prompt),
      completion: addCount(status.perf.completion, completion),
      errors: addCount(status.perf.errors, outcome === "error" ? 1 : 0),
    },
  };
  const samples: SampleInput[] = [];
  if (slug && AGENT_SLUG.test(slug)) {
    samples.push(
      { agent: slug, kind: "tokens_prompt", value: prompt },
      { agent: slug, kind: "tokens_completion", value: completion },
      { agent: slug, kind: "turn", value: 1 },
    );
  }
  return { status: next, log, samples };
}

function truncateRunes(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) {
    return value;
  }
  return chars.slice(0, max).join("");
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

function appendLog(ring: LogRing, line: { level: string; message: string; at: string; dropped?: number }): LogRing {
  const seq = ring.seq + 1;
  const next: LogLine = { seq, at: line.at, level: line.level, message: line.message };
  if (line.dropped != null && line.dropped > 0) {
    next.dropped = line.dropped;
  }
  const lines = [...ring.lines, next];
  return { seq, lines: lines.length > LOG_CAP ? lines.slice(lines.length - LOG_CAP) : lines };
}

function foldLog(ring: LogRing, raw: object, now: number): LogRing {
  const message = (raw as { message?: unknown }).message;
  if (typeof message !== "string" || message.length === 0) {
    return ring;
  }
  const levelRaw = (raw as { level?: unknown }).level;
  let level = "info";
  if (typeof levelRaw === "string" && levelRaw.trim()) {
    level = levelRaw.trim().toLowerCase().slice(0, 32);
  }
  const atRaw = (raw as { at?: unknown }).at;
  let at = new Date(now).toISOString();
  if (typeof atRaw === "string" && atRaw.length > 0 && atRaw.length <= 64 && !hasControl(atRaw)) {
    at = atRaw;
  }
  const droppedRaw = (raw as { dropped?: unknown }).dropped;
  let dropped: number | undefined;
  if (typeof droppedRaw === "number" && Number.isSafeInteger(droppedRaw) && droppedRaw > 0) {
    dropped = Math.min(droppedRaw, 1_000_000);
  }
  return appendLog(ring, { level, message: truncateRunes(message, MESSAGE_RUNES), at, dropped });
}

export function applyHarnessFrame(
  state: { status: AgentStatus; log: LogRing },
  raw: unknown,
  now: number,
  slug: string | null,
): HarnessFold {
  const base: HarnessFold = { status: state.status, log: state.log, samples: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return base;
  }
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "status") {
    return { ...base, status: foldStatus(state.status, raw) };
  }
  if (kind === "perf") {
    return foldPerf(state.status, state.log, raw, now, slug);
  }
  if (kind === "log") {
    const log = foldLog(state.log, raw, now);
    const line = log === state.log ? undefined : log.lines[log.lines.length - 1];
    const status = line && ERROR_LEVELS.has(line.level)
      ? { ...state.status, lastError: { message: line.message, at: line.at } }
      : state.status;
    return { ...base, status, log };
  }
  return base;
}

export function pageLog(ring: LogRing, after: number, limit = LOG_PAGE): LogPage {
  const cap = Math.min(LOG_PAGE, Math.max(1, Math.trunc(limit)));
  const lines = ring.lines.filter((line) => line.seq > after).slice(0, cap);
  const last = lines[lines.length - 1];
  const next = last ? last.seq : Math.max(after, ring.seq);
  return { lines, next };
}

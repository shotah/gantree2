/**
 * Behavioral-eval fixtures. JSON lives in `brain/eval/fixtures/` (the same
 * files as `harness/internal/agent/testdata/eval/`). One file is one scenario.
 * The loader is the spec for the fields; `docs/eval_setup.md` is the longer
 * version.
 *
 * JSON shape (snake_case, the Go tags):
 *
 * - `name`, `why` — `name` is what `EVAL_ONLY` matches. `why` is the rule.
 * - `inbound` — the human's text. `{{+120m}}` / `{{-30m}}` become the local
 *   clock that many minutes from the turn (`2:30PM`, no space, Go `3:04PM`).
 * - `planner` — send the daily planner wake instead of `inbound`.
 * - `cron` — send `cron`'s scheduled-job prefix plus this prompt.
 * - `surface`, `input` — phone context (`android`, `typed`, `spoken`).
 * - `history` — `{role, text}` turns appended before the inbound.
 * - `waiting` — arm `waiting_for_reply` first (a 👍 is an answer).
 * - `memory` — `{kind, subject, content, age_days?}`. `age_days` backdates
 *   the row so a stamp can say `(9d ago)`.
 * - `self` — SELF.md bullets. Absent means no note.
 * - `tools` — canned tools. `name` is `server__tool`. `result` is returned
 *   on every call; `{{+90m}}` inside it expands like `inbound`.
 * - `tools_from` — servers whose real plugin catalog (names, descriptions,
 *   schemas) replaces hand-written defs. Fixture rows for those servers
 *   carry `name` + `result` only. See `fixtures/mcp.toml`.
 * - `force` — MCP prefixes published without `mcp_enable`.
 * - `now` — RFC3339 freeze. Empty means the wall clock, held for the turn.
 * - `ledger` — scored events. `day_offset` is calendar days from the turn
 *   in America/Los_Angeles (yesterday is -1). `day` overrides that.
 * - `expect` — the shape contract (`tools_called`, `tools_not_called`,
 *   `order`, `reply_regex`, `reply_not_regex`, `max_questions`,
 *   `round_budget`, `wait`, `silent`, `react`, `react_only`,
 *   `no_model_call`, `prices_from_tools`, `evidence_from_turn`, `memory`,
 *   `cron_within`, `any_of`). `round_budget` is a cost note, never a fail.
 *   `{{memory:0}}` / `{{ledger:0}}` in a regex are seeded row ids.
 * - `next` — a second planner morning in the same session
 *   (`now`, `different_line`, `expect`). The first turn's `aim_log` is
 *   what the second morning sees.
 *
 * Regexes are Go RE2. A leading `(?i)` is the case-insensitive flag.
 * There is no lookaround in the fixtures.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atLocalTime, localParts } from "@/brain/core/clock";
import type { JsonSchema } from "@/brain/core/tools";
import { DailyPlannerPrefix, DefaultDailyPlannerPrompt, JobUserPrefix } from "@/brain/cron/prompts";

export const EVAL_TZ = "America/Los_Angeles";

export const fixtureDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

export const defaultPersonaPath = fileURLToPath(
  new URL("../../harness/examples/persona/PERSONA.example.md", import.meta.url),
);

export type EvalHistory = { role: string; text: string };

export type EvalMemory = {
  kind: string;
  subject: string;
  content: string;
  ageDays: number;
};

export type EvalLedger = {
  dayOffset: number;
  day: string;
  what: string;
  aims: Record<string, number>;
  note: string;
  ref: string;
  metric: string;
  value?: number;
  unit: string;
};

export type EvalTool = {
  name: string;
  description: string;
  params?: JsonSchema;
  result: string;
};

export type EvalCallExpect = {
  name: string;
  argsRegex: string;
  maxCalls?: number;
};

export type EvalMemoryExpect = { kind: string; subject: string };

export type EvalWindow = { afterMin: number; beforeMin: number };

export type EvalExpect = {
  toolsCalled: EvalCallExpect[];
  toolsNotCalled: string[];
  order: string[];
  replyRegex: string;
  replyNot: string;
  maxQuestions?: number;
  roundBudget?: number;
  wait?: boolean;
  silent?: boolean;
  react: string;
  reactOnly?: boolean;
  noModelCall?: boolean;
  pricesFromTools?: boolean;
  evidenceFromTurn?: boolean;
  memory: EvalMemoryExpect[];
  cronWithin?: EvalWindow;
  anyOf: EvalExpect[];
};

export type EvalNext = {
  now: string;
  differentLine: boolean;
  expect: EvalExpect;
};

export type EvalFixture = {
  name: string;
  why: string;
  inbound: string;
  planner: boolean;
  cron: string;
  surface: string;
  input: string;
  history: EvalHistory[];
  waiting: boolean;
  memory: EvalMemory[];
  self: string;
  tools: EvalTool[];
  ledger: EvalLedger[];
  toolsFrom: string[];
  force: string[];
  now: string;
  expect: EvalExpect;
  next?: EvalNext;
};

export function loadEvalFixtures(dir = fixtureDir): EvalFixture[] {
  const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  if (names.length === 0) {
    throw new Error(`no fixtures under ${dir}`);
  }
  return names.map((name) => loadEvalFixture(join(dir, name)));
}

export function loadEvalFixture(path: string): EvalFixture {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const fx = parseFixture(asRecord(parsed, path));
  if (fx.name === "") {
    fx.name = basename(path).replace(/\.json$/, "");
  }
  return fx;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Go `time.RFC3339`. Returns epoch ms, or null when the text is not that form. */
export function parseRfc3339(text: string): number | null {
  if (!RFC3339.test(text)) {
    return null;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

const CLOCK_RE = /\{\{([+-]\d+)m\}\}/g;

/** `{{+120m}}` → local `2:00PM` that many minutes after `nowMs`. */
export function expandEvalClock(text: string, nowMs: number, zone = EVAL_TZ): string {
  return text.replace(CLOCK_RE, (full, raw: string) => {
    const minutes = Number(raw);
    if (!Number.isFinite(minutes)) {
      return full;
    }
    return formatClock(nowMs + minutes * 60_000, zone);
  });
}

/**
 * The turn's text: the daily planner wake, a scheduled-job wake, or the
 * human's line. Same prefixes `brain/cron` puts on the wire.
 */
export function evalInboundText(fx: EvalFixture, nowMs: number, zone = EVAL_TZ): string {
  if (fx.planner) {
    return DailyPlannerPrefix + DefaultDailyPlannerPrompt;
  }
  if (fx.cron !== "") {
    return JobUserPrefix + expandEvalClock(fx.cron, nowMs, zone);
  }
  return expandEvalClock(fx.inbound, nowMs, zone);
}

/** Go layout `3:04PM` — no space, no leading zero on the hour. */
export function formatClock(ms: number, zone: string): string {
  const parts = localParts(ms, zone);
  let hour = parts.hour === 24 ? 0 : parts.hour;
  const suffix = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) {
    hour = 12;
  }
  return `${String(hour)}:${String(parts.minute).padStart(2, "0")}${suffix}`;
}

/** Calendar day `YYYY-MM-DD` of `ms` in `zone`, shifted by `days`. */
export function shiftLocalDay(ms: number, zone: string, days: number): string {
  const parts = localParts(ms, zone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${String(shifted.getUTCFullYear())}-${month}-${day}`;
}

/**
 * The same local wall clock, `days` calendar days away. Used to backdate
 * a memory row (`age_days`) without sliding across a DST jump by an hour.
 */
export function zonedAddDays(ms: number, zone: string, days: number): number {
  const parts = localParts(ms, zone);
  const day = shiftLocalDay(ms, zone, days);
  const [year, month, date] = day.split("-").map((part) => Number(part));
  const probe = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, 20, 0, 0);
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return atLocalTime(probe, zone, hour, parts.minute) + parts.second * 1000;
}

const ID_RE = /\{\{(ledger|memory):(\d+)\}\}/g;

export function expandEvalIds(text: string, ids: { ledger: readonly number[]; memory: readonly number[] }): string {
  return text.replace(ID_RE, (_full, kind: string, raw: string) => {
    const index = Number(raw);
    const list = kind === "memory" ? ids.memory : ids.ledger;
    const id = list[index];
    return id === undefined ? "0" : String(id);
  });
}

export function expandEvalExpect(want: EvalExpect, ids: { ledger: readonly number[]; memory: readonly number[] }): EvalExpect {
  return {
    ...want,
    toolsCalled: want.toolsCalled.map((call) => ({ ...call, argsRegex: expandEvalIds(call.argsRegex, ids) })),
    replyRegex: expandEvalIds(want.replyRegex, ids),
    replyNot: expandEvalIds(want.replyNot, ids),
    anyOf: want.anyOf.map((alt) => expandEvalExpect(alt, ids)),
  };
}

/**
 * Compile a fixture regex. Go's `(?i)` flag is not legal in JavaScript;
 * a leading one (every fixture that uses it) becomes the `i` flag.
 */
export function compileGoRegexp(pattern: string): RegExp {
  let source = pattern;
  let flags = "";
  if (source.startsWith("(?i)")) {
    flags = "i";
    source = source.slice(4);
  } else if (source.includes("(?i)")) {
    flags = "i";
    source = source.replaceAll("(?i)", "");
  }
  return new RegExp(source, flags);
}

/** Problems that should fail before any model call. Empty means well-formed. */
export function fixtureProblems(fx: EvalFixture, liveServers: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (fx.why === "") {
    problems.push("why is empty");
  }
  if (fx.inbound === "" && !fx.planner && fx.cron === "") {
    problems.push("needs inbound, planner, or cron");
  }
  for (const tool of fx.tools) {
    if (!tool.name.includes("__")) {
      problems.push(`canned tool ${JSON.stringify(tool.name)} needs an MCP prefix (server__name)`);
    }
  }
  if (fx.now !== "" && parseRfc3339(fx.now) === null) {
    problems.push(`now ${JSON.stringify(fx.now)} is not RFC3339`);
  }
  if (fx.next) {
    if (!fx.planner) {
      problems.push("next morning is a second planner turn");
    }
    if (parseRfc3339(fx.next.now) === null) {
      problems.push(`next.now ${JSON.stringify(fx.next.now)} is not RFC3339`);
    }
    if (!fx.next.differentLine) {
      problems.push("next morning must set different_line");
    }
    problems.push(...regexProblems(fx.next.expect).map((line) => `next ${line}`));
  }
  fx.ledger.forEach((row, index) => {
    if (row.what === "" || Object.keys(row.aims).length === 0) {
      problems.push(`ledger[${String(index)}] needs what and aims`);
    }
  });
  for (const server of fx.toolsFrom) {
    if (!liveServers.has(server)) {
      problems.push(`tools_from ${JSON.stringify(server)} is not a server in mcp.toml`);
    }
    for (const tool of fx.tools) {
      if (tool.name.startsWith(`${server}__`) && (tool.description !== "" || tool.params !== undefined)) {
        problems.push(`${tool.name} comes from the live catalog; drop its description/params`);
      }
    }
  }
  problems.push(...regexProblems(fx.expect));
  return problems;
}

function regexProblems(expect: EvalExpect): string[] {
  const problems: string[] = [];
  for (const pattern of [expect.replyRegex, expect.replyNot]) {
    if (pattern === "") {
      continue;
    }
    try {
      compileGoRegexp(pattern);
    } catch (err) {
      problems.push(`bad regex ${JSON.stringify(pattern)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const call of expect.toolsCalled) {
    if (call.argsRegex === "") {
      continue;
    }
    try {
      compileGoRegexp(call.argsRegex);
    } catch (err) {
      problems.push(`bad args_regex ${JSON.stringify(call.argsRegex)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const alt of expect.anyOf) {
    problems.push(...regexProblems(alt));
  }
  return problems;
}

function parseFixture(raw: Record<string, unknown>): EvalFixture {
  return {
    name: asString(raw.name),
    why: asString(raw.why),
    inbound: asString(raw.inbound),
    planner: raw.planner === true,
    cron: asString(raw.cron),
    surface: asString(raw.surface),
    input: asString(raw.input),
    history: asArray(raw.history).map((item) => {
      const row = asRecord(item, "history");
      return { role: asString(row.role), text: asString(row.text) };
    }),
    waiting: raw.waiting === true,
    memory: asArray(raw.memory).map((item) => {
      const row = asRecord(item, "memory");
      return {
        kind: asString(row.kind),
        subject: asString(row.subject),
        content: asString(row.content),
        ageDays: optNum(row.age_days) ?? 0,
      };
    }),
    self: asString(raw.self),
    tools: asArray(raw.tools).map((item) => parseTool(item)),
    ledger: asArray(raw.ledger).map((item) => parseLedger(item)),
    toolsFrom: asStringArray(raw.tools_from),
    force: asStringArray(raw.force),
    now: asString(raw.now),
    expect: parseExpect(raw.expect, "expect"),
    next: parseNext(raw.next),
  };
}

function parseNext(value: unknown): EvalNext | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = asRecord(value, "next");
  return {
    now: asString(raw.now),
    differentLine: raw.different_line === true,
    expect: parseExpect(raw.expect, "next.expect"),
  };
}

function parseTool(value: unknown): EvalTool {
  const raw = asRecord(value, "tools");
  const params = asSchema(raw.params);
  return {
    name: asString(raw.name),
    description: asString(raw.description),
    ...(params ? { params } : {}),
    result: asString(raw.result),
  };
}

function parseLedger(value: unknown): EvalLedger {
  const raw = asRecord(value, "ledger");
  const valueNum = optNum(raw.value);
  return {
    dayOffset: optNum(raw.day_offset) ?? 0,
    day: asString(raw.day),
    what: asString(raw.what),
    aims: asAims(raw.aims),
    note: asString(raw.note),
    ref: asString(raw.ref),
    metric: asString(raw.metric),
    ...(valueNum !== undefined ? { value: valueNum } : {}),
    unit: asString(raw.unit),
  };
}

function parseExpect(value: unknown, label: string): EvalExpect {
  const raw = asRecord(value ?? {}, label);
  const window = parseWindow(raw.cron_within);
  return {
    toolsCalled: asArray(raw.tools_called).map((item) => parseCall(item)),
    toolsNotCalled: asStringArray(raw.tools_not_called),
    order: asStringArray(raw.order),
    replyRegex: asString(raw.reply_regex),
    replyNot: asString(raw.reply_not_regex),
    ...(optNum(raw.max_questions) !== undefined ? { maxQuestions: optNum(raw.max_questions) } : {}),
    ...(optNum(raw.round_budget) !== undefined ? { roundBudget: optNum(raw.round_budget) } : {}),
    ...(optBool(raw.wait) !== undefined ? { wait: optBool(raw.wait) } : {}),
    ...(optBool(raw.silent) !== undefined ? { silent: optBool(raw.silent) } : {}),
    react: asString(raw.react),
    ...(optBool(raw.react_only) !== undefined ? { reactOnly: optBool(raw.react_only) } : {}),
    ...(optBool(raw.no_model_call) !== undefined ? { noModelCall: optBool(raw.no_model_call) } : {}),
    ...(optBool(raw.prices_from_tools) !== undefined ? { pricesFromTools: optBool(raw.prices_from_tools) } : {}),
    ...(optBool(raw.evidence_from_turn) !== undefined ? { evidenceFromTurn: optBool(raw.evidence_from_turn) } : {}),
    memory: asArray(raw.memory).map((item) => {
      const row = asRecord(item, `${label}.memory`);
      return { kind: asString(row.kind), subject: asString(row.subject) };
    }),
    ...(window ? { cronWithin: window } : {}),
    anyOf: asArray(raw.any_of).map((item, index) => parseExpect(item, `${label}.any_of[${String(index)}]`)),
  };
}

function parseCall(value: unknown): EvalCallExpect {
  const raw = asRecord(value, "tools_called");
  const maxCalls = optNum(raw.max_calls);
  return {
    name: asString(raw.name),
    argsRegex: asString(raw.args_regex),
    ...(maxCalls !== undefined ? { maxCalls } : {}),
  };
}

function parseWindow(value: unknown): EvalWindow | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = asRecord(value, "cron_within");
  return { afterMin: optNum(raw.after_min) ?? 0, beforeMin: optNum(raw.before_min) ?? 0 };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = item;
  }
  return out;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function asSchema(value: unknown): JsonSchema | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asRecord(value, "params");
}

function asAims(value: unknown): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  const raw = asRecord(value, "aims");
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item === "number") {
      out[key] = item;
    }
  }
  return out;
}

function optBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

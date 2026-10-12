import { errorResult, textResult, type JsonSchema, type Tool, type ToolResult } from "@/harness/core/tools";
import { addDays } from "./calendar";
import { AimsError } from "./error";
import { RUBRIC_TEXT } from "./rubric";
import { type AimStore } from "./store";
import { formatLine } from "./text";
import { SCORE_MAX, SCORE_MIN, SOURCE_DEFAULT, type LogInput } from "./types";

export const AIM_LOG = "aim_log";
export const AIM_HISTORY = "aim_history";

const HISTORY_DAYS = 14;
const MAX_INT32 = 2_147_483_647;
const MIN_INT32 = -2_147_483_648;

const AIM_LOG_DESCRIPTION = [
  "Record one event and your opinion of it toward each aim it touches. ",
  "aims is an object {area: score} with score -3..+3. The area must be a live aim/<area>. ",
  "ref (Garmin activity id or start time) replaces the previous row with that ref. ",
  "event rewrites that id (re-score). Same day without a ref appends. ",
  "Optional metric/value/unit rides along (weight 191.4 lb). note is what you did (nudged|asked|offered|praised|quiet). ",
  RUBRIC_TEXT,
].join("");

const AIM_LOG_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    what: { type: "string", description: "what happened, in the human's words" },
    aims: { type: "object", description: "area to score, e.g. {\"training\":2,\"weight\":1}" },
    day: { type: "string", description: "local YYYY-MM-DD; default today" },
    ref: { type: "string", description: "source id so a tool event is not logged twice" },
    note: { type: "string", description: "nudged, asked, offered, praised, or quiet" },
    metric: { type: "string" },
    value: { type: "number" },
    unit: { type: "string" },
    event: { type: "integer", description: "rewrite this ledger id" },
  },
  required: ["what", "aims"],
};

const AIM_HISTORY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    area: { type: "string" },
    from: { type: "string", description: "YYYY-MM-DD inclusive" },
    to: { type: "string", description: "YYYY-MM-DD inclusive" },
    limit: { type: "integer" },
  },
};

export type AimToolDef = { name: string; description: string; inputSchema: JsonSchema };

/** Ledger tool schemas, aim_log first. */
export function aimToolDefs(): AimToolDef[] {
  return [
    { name: AIM_LOG, description: AIM_LOG_DESCRIPTION, inputSchema: AIM_LOG_SCHEMA },
    {
      name: AIM_HISTORY,
      description: "List ledger rows with ids so you can review or re-score. Default is the last 14 days. Empty area lists every aim.",
      inputSchema: AIM_HISTORY_SCHEMA,
    },
  ];
}

export function isAimTool(name: string): boolean {
  return name === AIM_LOG || name === AIM_HISTORY;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!/^[+-]?\d+$/.test(s)) {
      throw new AimsError("not a number");
    }
    const n = Number(s);
    if (!Number.isSafeInteger(n)) {
      throw new AimsError("not a number");
    }
    return n;
  }
  throw new AimsError("not a number");
}

function intArg(args: Record<string, unknown>, key: string): number | undefined {
  if (!Object.hasOwn(args, key) || args[key] == null) {
    return undefined;
  }
  try {
    return asInt(args[key]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "not a number";
    throw new AimsError(`aims: bad ${key}: ${msg}`);
  }
}

function floatArg(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) {
      return undefined;
    }
    const n = Number(s);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function parseScores(raw: unknown): Record<string, number> {
  if (!isRecord(raw) || Object.keys(raw).length === 0) {
    throw new AimsError("aims: aims object is required");
  }
  const out: Record<string, number> = {};
  for (const [area, value] of Object.entries(raw)) {
    let n: number;
    try {
      n = asInt(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "not a number";
      throw new AimsError(`aims: score for ${area}: ${msg}`);
    }
    if (n < SCORE_MIN || n > SCORE_MAX) {
      throw new AimsError(`aims: score for ${area} must be ${String(SCORE_MIN)}..${String(SCORE_MAX)}, got ${String(n)}`);
    }
    out[area] = n;
  }
  return out;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    if (raw.length === 0 || raw === "null") {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AimsError(`aims: bad arguments: ${msg}`);
    }
    if (parsed === null) {
      return {};
    }
    if (!isRecord(parsed)) {
      throw new AimsError("aims: bad arguments: not an object");
    }
    return parsed;
  }
  if (raw == null) {
    return {};
  }
  if (!isRecord(raw)) {
    throw new AimsError("aims: bad arguments: not an object");
  }
  return raw;
}

function logCall(store: AimStore, args: Record<string, unknown>): string {
  const input: LogInput = {
    what: stringArg(args, "what"),
    day: stringArg(args, "day"),
    ref: stringArg(args, "ref"),
    note: stringArg(args, "note"),
    metric: stringArg(args, "metric"),
    unit: stringArg(args, "unit"),
    source: SOURCE_DEFAULT,
  };
  const eventId = intArg(args, "event");
  if (eventId !== undefined) {
    input.id = eventId;
  }
  if (Object.hasOwn(args, "value") && args.value != null) {
    const value = floatArg(args.value);
    if (value !== undefined) {
      input.value = value;
    }
  }
  const scores = parseScores(args.aims);
  return formatLine(store.log(input, scores));
}

function historyCall(store: AimStore, args: Record<string, unknown>): string {
  let from = stringArg(args, "from");
  let to = stringArg(args, "to");
  const n = intArg(args, "limit");
  let limit = 0;
  if (n !== undefined) {
    if (n > MAX_INT32 || n < MIN_INT32) {
      throw new AimsError(`aims: bad limit: ${String(n)}`);
    }
    limit = n;
  }
  if (!from && !to) {
    const today = store.today();
    from = addDays(today, -(HISTORY_DAYS - 1));
    to = today;
  }
  const rows = store.history(stringArg(args, "area"), from, to, limit);
  if (rows.length === 0) {
    return "no ledger rows";
  }
  return rows.map((ev) => formatLine(ev)).join("\n");
}

/** Run `aim_log` or `aim_history`. `raw` is a JSON object or the already-parsed arguments. */
export function callAim(store: AimStore, name: string, raw: unknown): string {
  const args = parseArgs(raw);
  switch (name) {
    case AIM_LOG:
      return logCall(store, args);
    case AIM_HISTORY:
      return historyCall(store, args);
    default:
      throw new AimsError(`aims: unknown tool ${JSON.stringify(name)}`);
  }
}

function toolResult(store: AimStore, name: string, args: Record<string, unknown>): ToolResult {
  try {
    return textResult(callAim(store, name, args));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "aims: tool failed";
    return errorResult(msg);
  }
}

/** The two ledger tools, for the agent loop to publish beside the other plugins. */
export function aimTools(store: AimStore): Tool[] {
  return aimToolDefs().map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    call: (args) => Promise.resolve(toolResult(store, def.name, args)),
  }));
}

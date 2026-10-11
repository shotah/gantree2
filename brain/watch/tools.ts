import { type CallContext, type JsonSchema, type Tool, type ToolDef, errorResult, textResult } from "@/brain/core/tools";
import {
  defaultIntervalSec,
  formatDuration,
  formatRfc3339,
  kindFloorSec,
  MAX_INTERVAL_SEC,
  parseInterval,
} from "./interval";
import { isRecord, parseJson } from "./json";
import { errorText, goQuote } from "./quote";
import { type WatchStore } from "./store";

export const TOOL_ADD = "watch_add";
export const TOOL_LIST = "watch_list";
export const TOOL_CANCEL = "watch_cancel";

/** Slowest-safe interval for a tool, in seconds. `0` means no floor. */
export type IntervalFloor = (tool: string) => number;

const ADD_DESCRIPTION = "Subscribe to an MCP fetch tool. The harness polls it on an interval "
  + "and wakes the agent only when new item ids appear. Quiet polls never call the model. "
  + "The first poll seeds the cursor (no flood of old items). "
  + "tool must be a prefixed MCP name (e.g. feeds__items_list). "
  + "args is the JSON object passed to that tool each tick. "
  + "interval defaults: feeds 60m (floor 15m), twitter__posts_list 6h (floor 1h), other tools 60m (floor 15m), max 7d. "
  + "A shorter interval is clamped up to that floor. "
  + "watches adds several subscriptions in one call; tool still adds one.";

const MAX_WATCHES_PER_CALL = 20;

export function toolDefs(): ToolDef[] {
  return [
    {
      name: TOOL_ADD,
      description: ADD_DESCRIPTION,
      inputSchema: objectSchema({
        tool: {
          type: "string",
          description: "prefixed MCP tool, e.g. feeds__items_list or twitter__posts_list",
        },
        args: {
          type: "object",
          description: "arguments passed to the tool each poll (e.g. {\"url\":\"https://…/rss.xml\"})",
        },
        interval: {
          type: "string",
          description: "how often to poll: 60m, 6h, 15m, or integer seconds. Default is 60m (6h for twitter). Floors: feeds 15m, twitter 1h, other 15m. Max 7d.",
        },
        label: {
          type: "string",
          description: "short name for watch_list (e.g. NWS Santa Clara)",
        },
        watches: {
          type: "array",
          description: "Subscriptions to add together (max 20). Each object has tool, args, interval, and label. tool still adds one.",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              args: { type: "object" },
              interval: { type: "string" },
              label: { type: "string" },
            },
          },
        },
      }, ["tool"]),
    },
    {
      name: TOOL_LIST,
      description: "List active watches.",
      inputSchema: objectSchema({}, []),
    },
    {
      name: TOOL_CANCEL,
      description: "Stop a watch by id from watch_list.",
      inputSchema: objectSchema({
        id: { type: "integer" },
      }, ["id"]),
    },
  ];
}

export function isWatchTool(name: string): boolean {
  return name === TOOL_ADD || name === TOOL_LIST || name === TOOL_CANCEL;
}

/**
 * The three builtin watch tools. A null store still publishes them; calls
 * fail with `watch: store not configured` so the model sees the error.
 * `floor` raises a shorter interval up to a server's call budget.
 */
export function watchTools(store: WatchStore | null, floor?: IntervalFloor): Tool[] {
  return toolDefs().map((def) => ({
    ...def,
    call: (args, ctx) => {
      try {
        return Promise.resolve(textResult(callWatchTool(store, def.name, args, ctx, floor)));
      } catch (err) {
        return Promise.resolve(errorResult(errorText(err)));
      }
    },
  }));
}

/**
 * Go `Tools.Call`: returns the tool text or throws. `args` may be a parsed
 * object or the raw JSON text the harness used to pass.
 */
export function callWatchTool(
  store: WatchStore | null,
  name: string,
  args: unknown,
  ctx: CallContext,
  floor?: IntervalFloor,
): string {
  if (store === null) throw new Error("watch: store not configured");
  const parsed = parseToolArgs(args);
  switch (name) {
    case TOOL_ADD:
      return addWatch(store, parsed, ctx, floor);
    case TOOL_LIST:
      return listWatches(store);
    case TOOL_CANCEL:
      return cancelWatch(store, parsed);
    default:
      throw new Error(`watch: unknown tool ${goQuote(name)}`);
  }
}

type Spec = { tool: string; args: unknown; interval: string; label: string };

function addWatch(
  store: WatchStore,
  args: Record<string, unknown>,
  ctx: CallContext,
  floor: IntervalFloor | undefined,
): string {
  if (ctx.sessionId === "") {
    throw new Error("watch: missing delivery context (add from an interactive turn)");
  }
  const specs = collectSpecs(args);
  if (specs.length === 0) throw new Error("watch: tool is required");
  if (specs.length > MAX_WATCHES_PER_CALL) throw new Error("watches accepts at most 20");
  const lines: string[] = [];
  let failed = 0;
  for (const spec of specs) {
    try {
      lines.push(addOne(store, spec, ctx, floor));
    } catch (err) {
      failed += 1;
      lines.push(`error: ${errorText(err)}`);
    }
  }
  if (failed === specs.length) throw new Error(lines.join("\n"));
  return lines.join("\n");
}

function addOne(
  store: WatchStore,
  spec: Spec,
  ctx: CallContext,
  floor: IntervalFloor | undefined,
): string {
  const tool = spec.tool.trim();
  const { seconds, note } = resolveInterval(tool, spec.interval, floor);
  const paused = store.findPaused(tool, spec.args === undefined ? null : spec.args);
  const watch = paused
    ? store.resume(paused.id, seconds, spec.label)
    : store.add(tool, spec.args === undefined ? null : spec.args, spec.label, seconds, {
        sessionId: ctx.sessionId,
        userId: ctx.userId,
      });
  const unpaused = paused ? " (unpaused)" : "";
  return `watching id=${watch.id} tool=${watch.tool} interval=${formatDuration(watch.intervalSeconds)} next_poll=${formatRfc3339(watch.nextPollAt)} label=${goQuote(watch.label)}${note}${unpaused}`;
}

function resolveInterval(
  tool: string,
  intervalRaw: string,
  floor: IntervalFloor | undefined,
): { seconds: number; note: string } {
  const secondsIn = intervalRaw.trim() === "" ? defaultIntervalSec(tool) : parseInterval(intervalRaw);
  const kindMin = kindFloorSec(tool);
  const budgetMin = floor ? Math.max(0, Math.trunc(floor(tool) || 0)) : 0;
  const min = Math.min(Math.max(kindMin, budgetMin), MAX_INTERVAL_SEC);
  if (secondsIn >= min) return { seconds: secondsIn, note: "" };
  if (budgetMin > kindMin) {
    return {
      seconds: min,
      note: ` (interval raised to ${formatDuration(min)}: that server has a call budget)`,
    };
  }
  return { seconds: min, note: ` (interval clamped to ${formatDuration(min)})` };
}

function collectSpecs(args: Record<string, unknown>): Spec[] {
  const out: Spec[] = [];
  const tool = typeof args.tool === "string" ? args.tool : "";
  if (tool.trim() !== "") {
    out.push({
      tool,
      args: args.args === undefined ? null : args.args,
      interval: intervalText(args.interval),
      label: typeof args.label === "string" ? args.label : "",
    });
  }
  if (!Array.isArray(args.watches)) return out;
  for (const row of args.watches) {
    if (!isRecord(row)) {
      out.push({ tool: "", args: null, interval: "", label: "" });
      continue;
    }
    out.push({
      tool: typeof row.tool === "string" ? row.tool : "",
      args: row.args === undefined ? null : row.args,
      interval: intervalText(row.interval),
      label: typeof row.label === "string" ? row.label : "",
    });
  }
  return out;
}

function intervalText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  return "";
}

function listWatches(store: WatchStore): string {
  const list = store.listSession("", false);
  if (list.length === 0) return "no active watches";
  return list.map((watch) => {
    let line = `id=${watch.id} tool=${watch.tool} interval=${formatDuration(watch.intervalSeconds)} next_due=${formatRfc3339(watch.nextPollAt)} label=${goQuote(watch.label)} state=${watch.state || "active"}`;
    if (watch.lastError !== "") line += ` last_error=${goQuote(watch.lastError)}`;
    return line;
  }).join("\n");
}

function cancelWatch(store: WatchStore, args: Record<string, unknown>): string {
  const id = asInt64(args.id);
  store.cancel(id);
  return `cancelled id=${id}`;
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) return {};
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed === "" || trimmed === "null") return {};
    try {
      return parseToolArgs(parseJson(trimmed));
    } catch (err) {
      throw new Error(`watch: bad arguments: ${errorText(err)}`, { cause: err });
    }
  }
  if (!isRecord(args)) throw new Error("watch: bad arguments: expected object");
  return args;
}

function asInt64(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  throw new Error(`watch: invalid id ${formatInvalid(v)}`);
}

function formatInvalid(v: unknown): string {
  if (v === null || v === undefined) return "<nil>";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  const encoded = JSON.stringify(v);
  return encoded ?? "";
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  const schema: JsonSchema = {
    type: "object",
    properties,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

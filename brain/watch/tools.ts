import { type CallContext, type JsonSchema, type Tool, type ToolDef, errorResult, textResult } from "@/brain/core/tools";
import { formatDuration, formatRfc3339, MAX_INTERVAL_SEC, parseInterval } from "./interval";
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
  + "interval: 15m (default), 1h, or seconds (minimum 1m).";

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
          description: "how often to poll: 15m, 1h, or integer seconds (default 15m, min 1m)",
        },
        label: {
          type: "string",
          description: "short name for watch_list (e.g. NWS Santa Clara)",
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

function addWatch(
  store: WatchStore,
  args: Record<string, unknown>,
  ctx: CallContext,
  floor: IntervalFloor | undefined,
): string {
  if (ctx.sessionId === "") {
    throw new Error("watch: missing delivery context (add from an interactive turn)");
  }
  const tool = typeof args.tool === "string" ? args.tool : "";
  const label = typeof args.label === "string" ? args.label : "";
  const intervalStr = typeof args.interval === "string" ? args.interval : "";
  let intervalSec = parseInterval(intervalStr);
  let raised = "";
  if (floor) {
    const floorSec = floor(tool.trim());
    if (floorSec > intervalSec) {
      intervalSec = Math.min(Math.trunc(floorSec), MAX_INTERVAL_SEC);
      raised = ` (interval raised to ${formatDuration(intervalSec)}: that server has a call budget)`;
    }
  }
  const watch = store.add(tool, args.args === undefined ? null : args.args, label, intervalSec, {
    sessionId: ctx.sessionId,
    userId: ctx.userId,
  });
  return `watching id=${watch.id} tool=${watch.tool} interval=${formatDuration(watch.intervalSeconds)} next_poll=${formatRfc3339(watch.nextPollAt)} label=${goQuote(watch.label)}${raised}`;
}

function listWatches(store: WatchStore): string {
  const list = store.listSession("", false);
  if (list.length === 0) return "no active watches";
  return list.map((watch) =>
    `id=${watch.id} tool=${watch.tool} interval=${formatDuration(watch.intervalSeconds)} next=${formatRfc3339(watch.nextPollAt)} label=${goQuote(watch.label)}`,
  ).join("\n");
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

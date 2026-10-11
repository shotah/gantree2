/**
 * Poll fetch tools on an interval and wake the agent only when new item ids
 * appear. Quiet ticks never call `onNewItems`. The Durable Object alarm asks
 * `nextDue()` and runs `pollDue`.
 */
export {
  DEFAULT_INTERVAL_SEC,
  DEFAULT_MAX_WATCHES,
  MAX_INTERVAL_SEC,
  MAX_SEEN_IDS,
  MIN_INTERVAL_SEC,
  formatDuration,
  formatRfc3339,
  parseInterval,
} from "./interval";
export { diffNew, formatItems, mergeSeen, parseItems } from "./items";
export type { Item } from "./items";
export { POLL_BATCH, WAKE_PREFIX } from "./poll";
export type { CallTool, OnNewItems, WatchWake } from "./poll";
export { AGENT_SESSION, WatchStore, watchMigrations } from "./store";
export type { Watch, WatchDelivery } from "./store";
export { TOOL_ADD, TOOL_CANCEL, TOOL_LIST, callWatchTool, isWatchTool, toolDefs, watchTools } from "./tools";
export type { IntervalFloor } from "./tools";

import { goQuote } from "./quote";

/** `feeds__items_list` — default poll and the floor under it. */
export const FEEDS_TOOL = "feeds__items_list";
export const FEEDS_DEFAULT_SEC = 60 * 60;
export const FEEDS_FLOOR_SEC = 15 * 60;

/** `twitter__posts_list` — default poll and the floor under it. */
export const TWITTER_TOOL = "twitter__posts_list";
export const TWITTER_DEFAULT_SEC = 6 * 60 * 60;
export const TWITTER_FLOOR_SEC = 60 * 60;

/**
 * `watch_add` default for every tool that is not twitter.
 * Feeds use this too. Kind-specific defaults live in `defaultIntervalSec`.
 */
export const DEFAULT_INTERVAL_SEC = 60 * 60;
/** Other tools share the feeds floor. The store still rejects anything under a minute. */
export const OTHER_FLOOR_SEC = 15 * 60;
/** Store-level sanity floor. Tool floors are higher and clamp instead of throwing. */
export const MIN_INTERVAL_SEC = 60;
/** A week — longer is a forgotten job. */
export const MAX_INTERVAL_SEC = 7 * 24 * 60 * 60;
/** Backoff stops doubling here. */
export const BACKOFF_CAP_SEC = 24 * 60 * 60;
/** This many fetch failures in a row pause the watch. */
export const PAUSE_AFTER_ERRORS = 5;
/** One alarm drains every due watch, this many fetches at a time. */
export const POLL_CONCURRENCY = 4;
/** Combined wake text keeps this many items; the rest are `+N more`. */
export const WATCH_WAKE_MAX_ITEMS = 20;
/** Next-due times share a slot so nearby watches fire on one alarm. */
export const GRID_MS = 5 * 60 * 1000;
/** Cursor cap so the row stays small. */
export const MAX_SEEN_IDS = 200;
/** Default active-watch cap when the constructor is given a non-positive max. */
export const DEFAULT_MAX_WATCHES = 50;

/** Interval used when `watch_add` omits one. Twitter is 6h; feeds and the rest are 60m. */
export function defaultIntervalSec(tool: string): number {
  if (tool.trim() === TWITTER_TOOL) return TWITTER_DEFAULT_SEC;
  return DEFAULT_INTERVAL_SEC;
}

/** Shortest interval `watch_add` will keep for this tool. Shorter values are clamped up. */
export function kindFloorSec(tool: string): number {
  if (tool.trim() === TWITTER_TOOL) return TWITTER_FLOOR_SEC;
  return OTHER_FLOOR_SEC;
}

/**
 * Next 5-minute boundary at or after `ms`. An instant already on the grid stays.
 * Scheduling uses this so watches due near each other share one alarm.
 */
export function snapUpGrid(ms: number): number {
  if (!Number.isFinite(ms)) return ms;
  return Math.ceil(ms / GRID_MS) * GRID_MS;
}

const UNIT_SECONDS: Record<string, number> = {
  ns: 1e-9,
  us: 1e-6,
  µs: 1e-6,
  μs: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
};

/**
 * Go `time.Duration.String` for whole seconds: `15m0s`, `1h0m0s`, `24h0m0s`.
 */
export function formatDuration(seconds: number): string {
  const rest = Math.trunc(Math.abs(seconds));
  if (rest === 0) return "0s";
  const h = Math.floor(rest / 3600);
  const m = Math.floor((rest % 3600) / 60);
  const s = rest % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

/** UTC `time.RFC3339` (no fractional seconds). */
export function formatRfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Go durations (`15m`, `1h`, `1h30m`) or integer seconds.
 * Returns whole seconds. Empty input is the default interval.
 */
export function parseInterval(input: string): number {
  const s = input.trim();
  if (s === "") return DEFAULT_INTERVAL_SEC;
  if (/^[+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 1) throw new Error("watch: interval must be positive");
    return clampInterval(n);
  }
  const seconds = parseGoDurationSeconds(s);
  if (seconds === null) {
    throw new Error(`watch: interval ${goQuote(s)}: use 15m, 1h, or seconds`);
  }
  return clampInterval(seconds);
}

function clampInterval(seconds: number): number {
  const whole = Math.trunc(seconds);
  if (whole < 1) throw new Error("watch: interval must be positive");
  if (whole > MAX_INTERVAL_SEC) {
    throw new Error(`watch: interval must be <= ${formatDuration(MAX_INTERVAL_SEC)}`);
  }
  return whole;
}

function parseGoDurationSeconds(input: string): number | null {
  let i = 0;
  let sign = 1;
  if (input.startsWith("-")) {
    sign = -1;
    i = 1;
  } else if (input.startsWith("+")) {
    i = 1;
  }
  if (i >= input.length) return null;
  let total = 0;
  let saw = false;
  while (i < input.length) {
    const numStart = i;
    let sawDigit = false;
    let sawDot = false;
    while (i < input.length) {
      const ch = input.charAt(i);
      if (ch >= "0" && ch <= "9") {
        sawDigit = true;
        i += 1;
        continue;
      }
      if (ch === "." && !sawDot) {
        sawDot = true;
        i += 1;
        continue;
      }
      break;
    }
    if (!sawDigit) return null;
    const num = Number(input.slice(numStart, i));
    if (!Number.isFinite(num)) return null;
    const unitStart = i;
    while (i < input.length && /[a-zA-Zµμ]/.test(input.charAt(i))) i += 1;
    if (i === unitStart) return null;
    const mult = UNIT_SECONDS[input.slice(unitStart, i)];
    if (mult === undefined) return null;
    total += num * mult;
    saw = true;
  }
  if (!saw) return null;
  return sign * total;
}

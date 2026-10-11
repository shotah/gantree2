import { goQuote } from "./quote";

/** `watch_add` default when interval is omitted. */
export const DEFAULT_INTERVAL_SEC = 15 * 60;
/** A watch must not spin a fetch tool faster than this. */
export const MIN_INTERVAL_SEC = 60;
/** A week — longer is a forgotten job. */
export const MAX_INTERVAL_SEC = 7 * 24 * 60 * 60;
/** Cursor cap so the row stays small. */
export const MAX_SEEN_IDS = 200;
/** Default active-watch cap when the constructor is given a non-positive max. */
export const DEFAULT_MAX_WATCHES = 50;

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
  if (seconds < MIN_INTERVAL_SEC) {
    throw new Error(`watch: interval must be >= ${formatDuration(MIN_INTERVAL_SEC)}`);
  }
  if (seconds > MAX_INTERVAL_SEC) {
    throw new Error(`watch: interval must be <= ${formatDuration(MAX_INTERVAL_SEC)}`);
  }
  return Math.trunc(seconds);
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

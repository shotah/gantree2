import { localParts, zoneOffsetMs, atLocalTime } from "@/brain/core/clock";

const UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 0.001,
  µs: 0.001,
  μs: 0.001,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

/** Go `time.ParseDuration` for the units cron schedules use (`30m`, `1h30m`, `1h0m0s`). */
export function parseDuration(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  let i = 0;
  let sign = 1;
  const head = text[0];
  if (head === "+" || head === "-") {
    if (head === "-") sign = -1;
    i += 1;
  }
  if (i >= text.length) return null;
  let total = 0;
  let saw = false;
  while (i < text.length) {
    const numStart = i;
    while (i < text.length && digit(text[i])) i += 1;
    if (i < text.length && text[i] === ".") {
      i += 1;
      while (i < text.length && digit(text[i])) i += 1;
    }
    if (i === numStart || text[numStart] === ".") {
      if (!(text[numStart] === "." && i > numStart + 1)) return null;
    }
    const num = Number(text.slice(numStart, i));
    if (!Number.isFinite(num)) return null;
    const unitStart = i;
    while (i < text.length && unitChar(text[i])) i += 1;
    const mult = UNIT_MS[text.slice(unitStart, i)];
    if (mult === undefined) return null;
    total += num * mult;
    saw = true;
  }
  if (!saw) return null;
  return Math.round(sign * total);
}

function digit(ch: string | undefined): boolean {
  return ch != null && ch >= "0" && ch <= "9";
}

function unitChar(ch: string | undefined): boolean {
  if (ch == null) return false;
  return (ch >= "a" && ch <= "z") || ch === "µ" || ch === "μ";
}

/** Go `Duration.String` for values of at least one second (`1h0m0s`, `30m0s`). */
export function formatDuration(ms: number): string {
  if (ms < 0) return `-${formatDuration(-ms)}`;
  if (ms === 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  let sec = Math.floor(ms / 1000);
  const fracMs = ms % 1000;
  const hours = Math.floor(sec / 3600);
  sec -= hours * 3600;
  const minutes = Math.floor(sec / 60);
  sec -= minutes * 60;
  let frac = "";
  if (fracMs !== 0) frac = `.${String(fracMs).padStart(3, "0").replace(/0+$/, "")}`;
  let out = "";
  if (hours > 0) out += `${hours}h`;
  if (hours > 0 || minutes > 0) out += `${minutes}m`;
  out += `${sec}${frac}s`;
  return out;
}

/** Go `time.RFC3339` in UTC (no fractional seconds). */
export function formatRfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Go `time.RFC3339Nano` in UTC, trailing zeros stripped. */
export function formatRfc3339Nano(ms: number): string {
  const iso = new Date(ms).toISOString();
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})Z$/.exec(iso);
  if (!m?.[1] || !m[2]) return iso;
  const frac = m[2].replace(/0+$/, "");
  return frac ? `${m[1]}.${frac}Z` : `${m[1]}Z`;
}

/**
 * Fixed 9-digit nanos so lexicographic `<=` matches instant order.
 * Millisecond precision; the remaining digits are zeros.
 */
export function formatCronTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})Z$/.exec(iso);
  if (!m?.[1] || !m[2]) throw new Error("cron: bad time");
  return `${m[1]}.${m[2]}000000Z`;
}

export function parseCronTime(s: string): number {
  const fixed = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{9})Z$/.exec(s);
  if (fixed?.[1] && fixed[2]) {
    const ms = Date.parse(`${fixed[1]}.${fixed[2].slice(0, 3)}Z`);
    if (!Number.isNaN(ms)) return ms;
  }
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) throw new Error(`cron: bad time ${s}`);
  return parsed;
}

/** IANA name, or `UTC`. Throws on an unknown zone. */
export function canonicalZone(name: string): string {
  const z = name.trim();
  if (!z || z.toLowerCase() === "utc") return "UTC";
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: z });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid time zone";
    throw new Error(`cron: timezone ${JSON.stringify(z)}: ${detail}`, { cause: err });
  }
  if (!fmt.resolvedOptions().timeZone) {
    throw new Error(`cron: timezone ${JSON.stringify(z)}`);
  }
  return z;
}

/** Unknown zones become UTC (boot paths that must still schedule). */
export function zoneOrUtc(name: string): string {
  try {
    return canonicalZone(name);
  } catch {
    return "UTC";
  }
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** One civil day in `zone`, keeping the wall clock (DST-safe versus +24h). */
export function addCalendarDays(ms: number, zone: string, days: number): number {
  const p = localParts(ms, zone);
  const hour = p.hour === 24 ? 0 : p.hour;
  const utc = Date.UTC(p.year, p.month - 1, p.day + days, hour, p.minute, p.second);
  const guess = utc - zoneOffsetMs(ms, zone);
  return utc - zoneOffsetMs(guess, zone);
}

/** Epoch ms for a wall clock in `zone`. */
export function atZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): number {
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = utc - zoneOffsetMs(utc, zone);
  return utc - zoneOffsetMs(guess, zone);
}

export function sameLocalDay(a: number, b: number, zone: string): boolean {
  const pa = localParts(a, zone);
  const pb = localParts(b, zone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Local midnight-or-hour on the civil day containing `ms`. Hour 24 is the next midnight. */
export function atLocalHour(ms: number, zone: string, hour: number): number {
  return atLocalTime(ms, zone, hour, 0);
}

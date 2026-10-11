import type { Clock } from "@/brain/core/clock";
import { localParts, zoneOffsetMs } from "@/brain/core/clock";
import { GarminError } from "./json";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayYmd(clock: Clock): string {
  const p = localParts(clock.now(), clock.zone);
  return `${String(p.year)}-${pad(p.month)}-${pad(p.day)}`;
}

/** time.RFC3339 in `clock.zone` (no fractional seconds). */
export function formatRfc3339(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  const off = zoneOffsetMs(ms, zone);
  let suffix = "Z";
  if (off !== 0) {
    const sign = off > 0 ? "+" : "-";
    const abs = Math.abs(off);
    const hh = Math.floor(abs / 3_600_000);
    const mm = Math.floor((abs % 3_600_000) / 60_000);
    suffix = `${sign}${pad(hh)}:${pad(mm)}`;
  }
  return `${String(p.year)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${suffix}`;
}

export function weekdayName(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  return WEEKDAYS[p.weekday] ?? "Sunday";
}

export function monthName(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  return MONTHS[p.month - 1] ?? "January";
}

/** `time.Parse("2006-01-02", value)` error text, or "" when the day is valid. */
export function goTimeParseError(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const quoted = JSON.stringify(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return `parsing time ${quoted} as "2006-01-02": cannot parse ${quoted} as "2006"`;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return `parsing time ${quoted}: month out of range`;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return `parsing time ${quoted}: day out of range`;
  }
  return "";
}

export function parseYmd(value: string, name: string): string {
  const err = goTimeParseError(value);
  if (err) throw new GarminError(`invalid date format for ${name}: ${err}`);
  return value;
}

/** Calendar shift, matching `time.Time.AddDate(0, 0, days)`. */
export function shiftYmd(ymd: string, days: number): string {
  const err = goTimeParseError(ymd);
  if (err) throw new GarminError(err);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(dt.getUTCFullYear())}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Date-range params the way the MCP handler does: default end=today, start=end−7,
 * then override whichever side was actually passed. A lone end does not recompute start.
 */
export function resolveRange(args: Record<string, unknown>, clock: Clock): { start: string; end: string } {
  const endDefault = todayYmd(clock);
  let start = shiftYmd(endDefault, -7);
  let end = endDefault;
  const startRaw = args.start;
  const endRaw = args.end;
  if (typeof startRaw === "string" && startRaw !== "") {
    const err = goTimeParseError(startRaw);
    if (err) throw new GarminError(`invalid start date: ${err}`);
    start = startRaw;
  }
  if (typeof endRaw === "string" && endRaw !== "") {
    const err = goTimeParseError(endRaw);
    if (err) throw new GarminError(`invalid end date: ${err}`);
    end = endRaw;
  }
  return { start, end };
}

export function resolveDate(args: Record<string, unknown>, name: string, clock: Clock): string {
  const v = args[name];
  if (typeof v === "string" && v !== "") return parseYmd(v, name);
  return todayYmd(clock);
}

/** Inclusive day list cap. One call cannot pull an unbounded history. */
export const DAY_CAP = 31;

/** Inclusive calendar days from `start` through `end`. Throws when the span exceeds {@link DAY_CAP}. */
export function inclusiveDays(start: string, end: string): string[] {
  if (start > end) throw new GarminError(`start ${start} is after end ${end}`);
  const days: string[] = [];
  let cursor = start;
  for (;;) {
    days.push(cursor);
    if (days.length > DAY_CAP) throw new GarminError(`date span exceeds ${DAY_CAP} days`);
    if (cursor === end) return days;
    cursor = shiftYmd(cursor, 1);
  }
}

function remember(out: string[], seen: Set<string>, day: string): void {
  if (seen.has(day)) return;
  seen.add(day);
  out.push(day);
  if (out.length > DAY_CAP) throw new GarminError(`date span exceeds ${DAY_CAP} days`);
}

/**
 * Days for a date-keyed tool. `dates` and `date` are explicit days; `start`/`end`
 * expand inclusively (a missing side is today). No argument is today. The result
 * is deduped and capped at {@link DAY_CAP}.
 */
export function resolveDayList(args: Record<string, unknown>, clock: Clock): string[] {
  const today = todayYmd(clock);
  const out: string[] = [];
  const seen = new Set<string>();
  if (Object.prototype.hasOwnProperty.call(args, "dates") && args.dates != null) {
    const dates = args.dates;
    if (!Array.isArray(dates)) throw new GarminError("dates must be a list of YYYY-MM-DD strings");
    for (const item of dates) {
      if (typeof item !== "string") throw new GarminError("dates must be a list of YYYY-MM-DD strings");
      if (item === "") continue;
      remember(out, seen, parseYmd(item, "dates"));
    }
  }
  const dateRaw = args.date;
  if (typeof dateRaw === "string" && dateRaw !== "") remember(out, seen, parseYmd(dateRaw, "date"));
  const startRaw = args.start;
  const endRaw = args.end;
  const hasStart = typeof startRaw === "string" && startRaw !== "";
  const hasEnd = typeof endRaw === "string" && endRaw !== "";
  if (hasStart || hasEnd) {
    const start = hasStart ? parseYmd(startRaw, "start") : today;
    const end = hasEnd ? parseYmd(endRaw, "end") : today;
    for (const day of inclusiveDays(start, end)) remember(out, seen, day);
  }
  if (out.length === 0) out.push(today);
  return out;
}

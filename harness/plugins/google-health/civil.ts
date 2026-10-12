import { localParts } from "@/harness/core/clock";

export type CivilDate = { year: number; month: number; day: number };

export function civilString(date: CivilDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function parseCivilDate(raw: string): CivilDate {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("empty civil date");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match === null) {
    throw new Error(`civil date ${JSON.stringify(raw)}: invalid date`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error(`civil date ${JSON.stringify(raw)}: invalid date`);
  }
  return { year, month, day };
}

export function todayCivil(nowMs: number, zone: string): CivilDate {
  const parts = localParts(nowMs, zone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function resolveDay(date: string, nowMs: number, zone: string): CivilDate {
  if (date.trim() === "") {
    return todayCivil(nowMs, zone);
  }
  return parseCivilDate(date);
}

export function filterDaySession(fieldPrefix: string, date: string, nowMs: number, zone: string): { filter: string; day: CivilDate } {
  const day = resolveDay(date, nowMs, zone);
  const next = addDays(day, 1);
  const filter = `${fieldPrefix}.interval.civil_end_time >= ${JSON.stringify(civilString(day))} AND ${fieldPrefix}.interval.civil_end_time < ${JSON.stringify(civilString(next))}`;
  return { filter, day };
}

export function filterSessionRange(fieldPrefix: string, after: string, before: string, nowMs: number, zone: string): string {
  const parts: string[] = [];
  if (after.trim() !== "") {
    const start = parseCivilDate(after);
    parts.push(`${fieldPrefix}.interval.civil_start_time >= ${JSON.stringify(civilString(start))}`);
  }
  if (before.trim() !== "") {
    const end = parseCivilDate(before);
    parts.push(`${fieldPrefix}.interval.civil_start_time < ${JSON.stringify(civilString(end))}`);
  }
  if (parts.length === 0) {
    const end = addDays(todayCivil(nowMs, zone), 1);
    const start = addDays(end, -7);
    parts.push(`${fieldPrefix}.interval.civil_start_time >= ${JSON.stringify(civilString(start))}`);
    parts.push(`${fieldPrefix}.interval.civil_start_time < ${JSON.stringify(civilString(end))}`);
  }
  return parts.join(" AND ");
}

export function filterDailyDate(fieldPrefix: string, date: string, nowMs: number, zone: string): { filter: string; day: CivilDate } {
  const day = resolveDay(date, nowMs, zone);
  return {
    filter: `${fieldPrefix}.date = date(${String(day.year)}, ${String(day.month)}, ${String(day.day)})`,
    day,
  };
}

type DateWindow = { start: CivilDate; end: CivilDate; openStart: boolean };

function resolveRange(after: string, before: string, nowMs: number, zone: string): DateWindow {
  const openStart = after.trim() === "";
  const start = openStart ? todayCivil(nowMs, zone) : parseCivilDate(after);
  const end = before.trim() === "" ? addDays(todayCivil(nowMs, zone), 1) : parseCivilDate(before);
  if (!openStart && civilString(end) <= civilString(start)) {
    throw new Error(`before_date ${civilString(end)} must be after after_date ${civilString(start)}`);
  }
  return { start, end, openStart };
}

function rangeRequested(after: string, before: string): boolean {
  return after.trim() !== "" || before.trim() !== "";
}

export function filterSleepWindow(date: string, after: string, before: string, nowMs: number, zone: string): string {
  if (!rangeRequested(after, before)) {
    return filterDaySession("sleep", date, nowMs, zone).filter;
  }
  const window = resolveRange(after, before, nowMs, zone);
  const parts: string[] = [];
  if (!window.openStart) {
    parts.push(`sleep.interval.civil_end_time >= ${JSON.stringify(civilString(window.start))}`);
  }
  parts.push(`sleep.interval.civil_end_time < ${JSON.stringify(civilString(window.end))}`);
  return parts.join(" AND ");
}

export function filterDailyWindow(fieldPrefix: string, date: string, after: string, before: string, nowMs: number, zone: string): string {
  if (!rangeRequested(after, before)) {
    return filterDailyDate(fieldPrefix, date, nowMs, zone).filter;
  }
  const window = resolveRange(after, before, nowMs, zone);
  const parts: string[] = [];
  if (!window.openStart) {
    parts.push(`${fieldPrefix}.date >= date(${String(window.start.year)}, ${String(window.start.month)}, ${String(window.start.day)})`);
  }
  parts.push(`${fieldPrefix}.date < date(${String(window.end.year)}, ${String(window.end.month)}, ${String(window.end.day)})`);
  return parts.join(" AND ");
}

export function filterWeightPeriod(baseDate: string, period: string, nowMs: number, zone: string): string {
  const end = baseDate.trim() === "" ? todayCivil(nowMs, zone) : parseCivilDate(baseDate);
  const days = weightDays(period);
  const start = addDays(end, -days);
  const next = addDays(end, 1);
  return `weight.sample_time.civil_time.date >= date(${String(start.year)}, ${String(start.month)}, ${String(start.day)}) AND weight.sample_time.civil_time.date < date(${String(next.year)}, ${String(next.month)}, ${String(next.day)})`;
}

/** Inclusive day-list cap for one tool call. */
export const DAY_CAP = 31;

/** Inclusive calendar days from `startRaw` through `endRaw`. */
export function expandInclusive(startRaw: string, endRaw: string): string[] {
  const start = parseCivilDate(startRaw);
  const end = parseCivilDate(endRaw);
  if (civilString(end) < civilString(start)) {
    throw new Error(`end ${civilString(end)} is before start ${civilString(start)}`);
  }
  const days: string[] = [];
  let cursor = start;
  for (;;) {
    days.push(civilString(cursor));
    if (days.length > DAY_CAP) throw new Error(`date span exceeds ${DAY_CAP} days`);
    if (civilString(cursor) === civilString(end)) return days;
    cursor = addDays(cursor, 1);
  }
}

function rememberDay(out: string[], seen: Set<string>, day: string): void {
  const parsed = civilString(parseCivilDate(day));
  if (seen.has(parsed)) return;
  seen.add(parsed);
  out.push(parsed);
  if (out.length > DAY_CAP) throw new Error(`date span exceeds ${DAY_CAP} days`);
}

/**
 * Days for a date-keyed health tool. `dates` and `date` are explicit; `start`/`end`
 * are inclusive (a missing side is today). `after_date`/`before_date` stay, with
 * `before_date` exclusive. No argument is today.
 */
export function resolveHealthDays(args: Record<string, unknown>, nowMs: number, zone: string): string[] {
  const today = civilString(todayCivil(nowMs, zone));
  const out: string[] = [];
  const seen = new Set<string>();
  if (Object.hasOwn(args, "dates") && args.dates != null) {
    if (!Array.isArray(args.dates)) throw new Error("dates must be a list of YYYY-MM-DD strings");
    for (const item of args.dates) {
      if (typeof item !== "string") throw new Error("dates must be a list of YYYY-MM-DD strings");
      if (item.trim() === "") continue;
      rememberDay(out, seen, item);
    }
  }
  const date = typeof args.date === "string" ? args.date.trim() : "";
  if (date !== "") rememberDay(out, seen, date);
  const start = typeof args.start === "string" ? args.start.trim() : "";
  const end = typeof args.end === "string" ? args.end.trim() : "";
  if (start !== "" || end !== "") {
    for (const day of expandInclusive(start || today, end || today)) rememberDay(out, seen, day);
  }
  const after = typeof args.after_date === "string" ? args.after_date.trim() : "";
  const before = typeof args.before_date === "string" ? args.before_date.trim() : "";
  if (out.length === 0 && (after !== "" || before !== "")) {
    const endInclusive = before !== "" ? civilString(addDays(parseCivilDate(before), -1)) : today;
    const startDay = after !== ""
      ? after
      : civilString(addDays(parseCivilDate(endInclusive), -(DAY_CAP - 1)));
    if (civilString(parseCivilDate(endInclusive)) >= civilString(parseCivilDate(startDay))) {
      for (const day of expandInclusive(startDay, endInclusive)) rememberDay(out, seen, day);
    }
  }
  if (out.length === 0) out.push(today);
  return out;
}

export function weightPeriodDays(period: string): number {
  return weightDays(period === "" ? "1m" : period);
}

function weightDays(period: string): number {
  switch (period.trim().toLowerCase()) {
    case "":
    case "1m":
    case "30d":
      return 30;
    case "3m":
    case "90d":
      return 90;
    case "1w":
    case "7d":
      return 7;
    case "6m":
      return 180;
    case "1y":
    case "12m":
      return 365;
    default: {
      if (period.endsWith("d")) {
        const n = Number.parseInt(period.slice(0, -1), 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`unsupported weight period ${JSON.stringify(period)}`);
        }
        return n;
      }
      throw new Error(`unsupported weight period ${JSON.stringify(period)} (use 1m, 3m, 7d, …)`);
    }
  }
}

export function parseDurationSeconds(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return 0;
  }
  const value = Number.parseFloat(trimmed.endsWith("s") ? trimmed.slice(0, -1) : trimmed);
  return Number.isFinite(value) ? value : 0;
}

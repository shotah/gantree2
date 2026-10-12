import { atLocalTime, localParts } from "@/harness/core/clock";
import { KindDaily, KindDailyPlanner, KindEvery, KindExamples, KindExamplesPing, KindFollowUp, KindOnce, PlannerOff } from "./constants";
import { parseSpread, planSpreadNext } from "./spread";
import type { Parsed } from "./types";
import {
  addCalendarDays,
  canonicalZone,
  formatDuration,
  formatRfc3339,
  formatRfc3339Nano,
  pad2,
  parseDuration,
  sameLocalDay,
} from "./time";

/** "07:10", "7:10", "9am", "9:30pm". "0" is off and is not a clock. */
export function parsePlannerAt(raw: string): { hour: number; minute: number } {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("planner:")) s = s.slice("planner:".length).trim();
  if (!s || s === PlannerOff) throw new Error("cron: empty planner time");
  let ampm = "";
  if (s.endsWith("am") || s.endsWith("pm")) {
    ampm = s.slice(-2);
    s = s.slice(0, -2).trim();
  }
  let hour: number;
  let minute: number;
  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length !== 2) throw new Error(`cron: bad planner time ${JSON.stringify(s)}`);
    const h = strictInt(parts[0] ?? "");
    const m = strictInt(parts[1] ?? "");
    if (h == null || m == null) throw new Error(`cron: bad planner time ${JSON.stringify(s)}`);
    hour = h;
    minute = m;
  } else {
    const h = strictInt(s);
    if (h == null) throw new Error(`cron: bad planner time ${JSON.stringify(s)}`);
    hour = h;
    minute = 0;
  }
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (ampm !== "" && (hour < 0 || hour > 23)) throw new Error("cron: bad planner time");
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`cron: planner time must be a clock (got ${pad2(hour)}:${pad2(minute)})`);
  }
  return { hour, minute };
}

export function formatPlannerAt(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Next fire of the daily session. A session already running, or one that
 * already ran today, waits until tomorrow so a mid-session clock move does
 * not buy a second burn today.
 */
export function nextPlannerAt(
  hour: number,
  minute: number,
  zone: string,
  now: number,
  lastRun: number | null,
  running: boolean,
): number {
  const loc = zone.trim() ? canonicalZone(zone) : "UTC";
  const slot = atLocalTime(now, loc, hour, minute);
  if (running || (lastRun != null && sameLocalDay(lastRun, now, loc))) {
    return addCalendarDays(slot, loc, 1);
  }
  if (slot > now) return slot;
  return addCalendarDays(slot, loc, 1);
}

export function parsePlannerSchedule(when: string, zone: string, now: number): Parsed {
  const { hour, minute } = parsePlannerAt(when);
  const loc = zone.trim() ? canonicalZone(zone) : "UTC";
  return {
    kind: KindDailyPlanner,
    expr: formatPlannerAt(hour, minute),
    nextRun: nextPlannerAt(hour, minute, loc, now, null, false),
    timezone: loc,
  };
}

function strictInt(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

export function dailyAt(hour: number, minute: number, zone: string, now: number): Parsed {
  let next = atLocalTime(now, zone, hour, minute);
  if (next <= now) next = addCalendarDays(next, zone, 1);
  return { kind: KindDaily, expr: formatPlannerAt(hour, minute), nextRun: next, timezone: zone };
}

function parseClock(when: string): { hour: number; minute: number; second: number } | null {
  const hms = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(when);
  if (hms?.[1] && hms[2] && hms[3]) {
    const hour = Number(hms[1]);
    const minute = Number(hms[2]);
    const second = Number(hms[3]);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return { hour, minute, second };
  }
  const ampm = /^(\d{1,2}):(\d{2})([AaPp][Mm])$/.exec(when);
  if (ampm?.[1] && ampm[2] && ampm[3]) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (ampm[3].toLowerCase() === "pm" && hour < 12) hour += 12;
    if (ampm[3].toLowerCase() === "am" && hour === 12) hour = 0;
    return { hour, minute, second: 0 };
  }
  const hm = /^(\d{1,2}):(\d{2})$/.exec(when);
  if (hm?.[1] && hm[2]) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute, second: 0 };
  }
  return null;
}

function parseAbsolute(when: string, zone: string, now: number): number | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(when)) {
    const ms = Date.parse(when);
    if (!Number.isNaN(ms)) return ms;
  }
  const clock = parseClock(when);
  if (!clock) return null;
  let cand = atLocalTime(now, zone, clock.hour, clock.minute) + clock.second * 1000;
  if (cand <= now) cand = addCalendarDays(cand, zone, 1);
  return cand;
}

/**
 * Tool `when` / `repeat` into a concrete next run.
 *
 * when: RFC3339, "15:04" / "3:04PM", "in 30m", "every:1h".
 * repeat: "once" (default), "daily", "every:30m", "planner".
 */
export function parseSchedule(whenRaw: string, repeatRaw: string, zone: string, now: number): Parsed {
  const when = whenRaw.trim();
  let repeat = repeatRaw.trim().toLowerCase();
  if (!when) throw new Error("cron: when is required");
  const loc = zone.trim() ? canonicalZone(zone) : "UTC";
  if (!repeat) repeat = KindOnce;

  if (repeat.startsWith("every:") || when.startsWith("every:")) {
    const spec = when.startsWith("every:") ? when : repeat;
    const durStr = spec.slice("every:".length).trim();
    const d = parseDuration(durStr);
    if (d == null || d < 60_000) {
      throw new Error(`cron: invalid every duration ${JSON.stringify(durStr)} (min 1m)`);
    }
    return { kind: KindEvery, expr: formatDuration(d), nextRun: now + d, timezone: loc };
  }

  if (repeat === KindDailyPlanner || repeat === "planner" || when.startsWith("planner:")) {
    return parsePlannerSchedule(when, loc, now);
  }

  if (when.startsWith("in ")) {
    const d = parseDuration(when.slice(3).trim());
    if (d == null || d <= 0) throw new Error(`cron: invalid relative when ${JSON.stringify(when)}`);
    const next = now + d;
    if (repeat === KindDaily) {
      const p = localParts(next, loc);
      return dailyAt(p.hour, p.minute, loc, now);
    }
    if (repeat !== KindOnce) {
      throw new Error(`cron: repeat ${JSON.stringify(repeat)} incompatible with relative when`);
    }
    return { kind: KindOnce, expr: formatRfc3339Nano(next), nextRun: next, timezone: loc };
  }

  const abs = parseAbsolute(when, loc, now);
  if (abs != null) {
    if (repeat === KindOnce) {
      if (abs <= now) throw new Error(`cron: when ${formatRfc3339(abs)} is not in the future`);
      return { kind: KindOnce, expr: formatRfc3339Nano(abs), nextRun: abs, timezone: loc };
    }
    if (repeat === KindDaily) {
      const p = localParts(abs, loc);
      return dailyAt(p.hour, p.minute, loc, now);
    }
    throw new Error(`cron: invalid repeat ${JSON.stringify(repeat)}`);
  }
  throw new Error(`cron: cannot parse when ${JSON.stringify(when)}`);
}

export type Advance = { next: number; newExpr: string; ok: boolean };

/**
 * The run after `from`. `ok` is false for one-shots (the job should disable).
 * `newExpr` is empty when the stored expression does not change.
 */
export function advanceNext(kind: string, expr: string, tz: string, from: number): Advance {
  const loc = canonicalZone(tz);
  switch (kind) {
    case KindOnce:
    case KindExamplesPing:
    case KindFollowUp:
      return { next: 0, newExpr: "", ok: false };
    case KindDaily:
    case KindDailyPlanner: {
      const parts = expr.split(":");
      if (parts.length !== 2) throw new Error(`cron: bad daily expr ${JSON.stringify(expr)}`);
      const hour = atoi(parts[0] ?? "");
      const minute = atoi(parts[1] ?? "");
      let next = atLocalTime(from, loc, hour, minute);
      if (next <= from) next = addCalendarDays(next, loc, 1);
      return { next, newExpr: "", ok: true };
    }
    case KindEvery: {
      const d = parseDuration(expr);
      if (d == null) throw new Error(`cron: bad every expr ${JSON.stringify(expr)}`);
      return { next: from + d, newExpr: "", ok: true };
    }
    case KindExamples:
      return { next: planSpreadNext(parseSpread(expr), loc, from), newExpr: "", ok: true };
    default:
      throw new Error(`cron: unknown kind ${JSON.stringify(kind)}`);
  }
}

function atoi(s: string): number {
  const n = Number(s);
  return Number.isInteger(n) ? n : 0;
}

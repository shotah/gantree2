import { atLocalTime, localParts } from "@/brain/core/clock";
import { asleepAt } from "@/brain/cron/hours";
import { parseHours } from "@/brain/memory/hours";

/**
 * Quiet hours for a watch alarm. The planner's helper is `asleepAt` on the
 * `pref/hours` sleep window (end minute exclusive, unknown hours are awake).
 * A `quiet:` HH:MM-HH:MM line is the same kind of window and defers too.
 * Work does not.
 *
 * Returns the first awake instant when `at` is inside one of those windows,
 * otherwise null. Callers snap that instant up to the watch grid.
 */
export function quietResumeAt(content: string, at: number, zone: string): number | null {
  const z = zone.trim() || "UTC";
  if (!isQuiet(content, at, z)) return null;
  const windows = windowsOf(content);
  let cursor = at;
  for (let i = 0; i < 4; i += 1) {
    const end = coveringEnd(cursor, z, windows);
    if (end === null || end <= cursor) return stepUntilAwake(content, cursor, z);
    if (!isQuiet(content, end, z)) return end;
    cursor = end;
  }
  return stepUntilAwake(content, cursor, z);
}

type Window = { start: number; end: number };

function isQuiet(content: string, at: number, zone: string): boolean {
  if (asleepAt(content, at, zone)) return true;
  const extra = parseHmWindow(parseHours(content).quiet);
  if (!extra) return false;
  return inLocalWindow(at, zone, extra);
}

function windowsOf(content: string): Window[] {
  const hours = parseHours(content);
  const out: Window[] = [];
  if (hours.known()) out.push({ start: hours.sleepStart, end: hours.sleepEnd });
  const extra = parseHmWindow(hours.quiet);
  if (extra) out.push(extra);
  return out;
}

function coveringEnd(at: number, zone: string, windows: readonly Window[]): number | null {
  let best: number | null = null;
  for (const w of windows) {
    if (!inLocalWindow(at, zone, w)) continue;
    const end = windowEndMs(at, zone, w);
    if (best === null || end > best) best = end;
  }
  return best;
}

function windowEndMs(at: number, zone: string, w: Window): number {
  const today = onLocalDay(at, zone, 0, w.end);
  if (today > at) return today;
  return onLocalDay(at, zone, 1, w.end);
}

function onLocalDay(at: number, zone: string, dayOffset: number, minuteOfDay: number): number {
  const p = localParts(at, zone);
  const target = civilAdd(p.year, p.month, p.day, dayOffset);
  let guess = Date.UTC(target.year, target.month - 1, target.day, 12, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const got = localParts(guess, zone);
    if (got.year === target.year && got.month === target.month && got.day === target.day) break;
    const gotDay = Date.UTC(got.year, got.month - 1, got.day);
    const wantDay = Date.UTC(target.year, target.month - 1, target.day);
    const deltaDays = Math.round((wantDay - gotDay) / 86_400_000);
    if (deltaDays === 0) break;
    guess += deltaDays * 86_400_000;
  }
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return atLocalTime(guess, zone, hour, minute);
}

function civilAdd(year: number, month: number, day: number, offset: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + offset));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function inLocalWindow(at: number, zone: string, w: Window): boolean {
  const p = localParts(at, zone);
  const hour = p.hour === 24 ? 0 : p.hour;
  return inWindow(hour * 60 + p.minute, w.start, w.end);
}

/** Same end-exclusive rule as the planner's sleep window. */
function inWindow(t: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

function parseHmWindow(s: string): Window | null {
  const norm = s.trim().replaceAll("–", "-").replaceAll("—", "-");
  const cut = norm.indexOf("-");
  if (cut < 0) return null;
  const start = parseHm(norm.slice(0, cut));
  const end = parseHm(norm.slice(cut + 1));
  if (start === null || end === null) return null;
  return { start, end };
}

function parseHm(s: string): number | null {
  const t = s.trim();
  const cut = t.indexOf(":");
  if (cut < 0) return null;
  const h = Number(t.slice(0, cut));
  const m = Number(t.slice(cut + 1));
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function stepUntilAwake(content: string, at: number, zone: string): number {
  const step = 60_000;
  for (let i = 1; i <= 36 * 60; i += 1) {
    const next = at + i * step;
    if (!isQuiet(content, next, zone)) return next;
  }
  return at + 36 * 60 * step;
}

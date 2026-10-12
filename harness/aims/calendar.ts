import { localParts } from "@/harness/core/clock";
import { AimsError } from "./error";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function badDay(day: string): AimsError {
  return new AimsError(`aims: bad day ${JSON.stringify(day)}`);
}

/** `YYYY-MM-DD`, or throw. Blank is its own error so callers can tell them apart. */
export function parseDay(day: string): string {
  const trimmed = day.trim();
  if (!trimmed) {
    throw new AimsError("aims: empty day");
  }
  const match = DAY.exec(trimmed);
  const year = match?.[1];
  const month = match?.[2];
  const date = match?.[3];
  if (!year || !month || !date) {
    throw badDay(trimmed);
  }
  const y = Number(year);
  const m = Number(month);
  const d = Number(date);
  const stamp = new Date(Date.UTC(y, m - 1, d));
  if (stamp.getUTCFullYear() !== y || stamp.getUTCMonth() !== m - 1 || stamp.getUTCDate() !== d) {
    throw badDay(trimmed);
  }
  return trimmed;
}

/** Calendar shift of a `YYYY-MM-DD`. Uses UTC dates so DST does not skip a day. */
export function addDays(day: string, n: number): string {
  const trimmed = parseDay(day);
  const match = DAY.exec(trimmed);
  const year = match?.[1];
  const month = match?.[2];
  const date = match?.[3];
  if (!year || !month || !date) {
    throw badDay(trimmed);
  }
  const stamp = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date) + n));
  const y = String(stamp.getUTCFullYear()).padStart(4, "0");
  const m = String(stamp.getUTCMonth() + 1).padStart(2, "0");
  const d = String(stamp.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Sunday on or before `day`. Weekday is a property of the civil date. */
export function weekStart(day: string): string {
  const trimmed = parseDay(day);
  const match = DAY.exec(trimmed);
  const year = match?.[1];
  const month = match?.[2];
  const date = match?.[3];
  if (!year || !month || !date) {
    throw badDay(trimmed);
  }
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date))).getUTCDay();
  return addDays(trimmed, -weekday);
}

/** `YYYY-MM-DD` of `ms` in `zone`. */
export function localDay(ms: number, zone: string): string {
  const parts = localParts(ms, zone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${String(parts.year).padStart(4, "0")}-${month}-${day}`;
}

/** True when `ms` falls on Sunday in `zone`. */
export function isSunday(ms: number, zone: string): boolean {
  return localParts(ms, zone).weekday === 0;
}

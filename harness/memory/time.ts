import { localParts } from "@/harness/core/clock";

export const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** UTC timestamp stored in `created_at` / `updated_at` / `expires_at`. */
export function rfc3339(ms: number): string {
  return new Date(ms).toISOString();
}

/** Local calendar day `YYYY-MM-DD` of `ms` in `zone`. */
export function localDay(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  const month = String(p.month).padStart(2, "0");
  const day = String(p.day).padStart(2, "0");
  return `${String(p.year).padStart(4, "0")}-${month}-${day}`;
}

/** `Mon 2006-01-02` in `zone`. The weekday is useless without the date. */
export function weekdayDate(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  const name = WEEKDAYS[p.weekday] ?? "Sun";
  return `${name} ${localDay(ms, zone)}`;
}

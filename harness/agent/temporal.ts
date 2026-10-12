/**
 * Per-turn clock the model reads after the human's words. Dates are ISO so a
 * weekday-only memory cannot be reused after the week rolls.
 */
import { localParts, zoneOffsetMs } from "@/harness/core/clock";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SLOTS = [
  { name: "overnight", lo: 0, hi: 5 },
  { name: "early morning", lo: 5, hi: 8 },
  { name: "morning", lo: 8, hi: 11 },
  { name: "lunch", lo: 11, hi: 13 },
  { name: "afternoon", lo: 13, hi: 17 },
  { name: "evening", lo: 17, hi: 21 },
  { name: "night", lo: 21, hi: 24 },
];

type Day = { year: number; month: number; day: number; weekday: number };

export function temporalAnchor(nowMs: number, zone: string, tzName: string): string {
  const name = tzName.trim() === "" ? zone : tzName;
  const p = parts(nowMs, zone);
  const yesterday = shift(p, -1);
  const tomorrow = shift(p, 1);
  const { part, already, ahead } = dayPart(p.hour);
  const notUtc = isUtcName(name) ? "" : " Human local time, not UTC.";
  const clock = format12(p.hour, p.minute, true);
  return [
    `[current time] NOW: ${WEEKDAYS[p.weekday] ?? "Sunday"} ${MONTHS[p.month - 1] ?? "January"} ${String(p.day)}, ${String(p.year)} ${clock} ${formatZone(nowMs, zone, name)} — ${dayPartCallout(part)}.${notUtc}`,
    `already today: 12:00 AM–${clock} (${joinParts(already)})`,
    `remaining today: ${clock}–11:59 PM (${joinParts(ahead)})`,
    `yesterday=${iso(yesterday)} (${WEEKDAYS[yesterday.weekday] ?? "Sunday"}) · today=${iso(p)} (${WEEKDAYS[p.weekday] ?? "Sunday"}) · tomorrow=${iso(tomorrow)} (${WEEKDAYS[tomorrow.weekday] ?? "Sunday"})`,
    `this week: ${formatWeek(p)}`,
    `next week starts ${iso(shift(sunday(p), 7))} — weekday-only notes (e.g. "Monday") are not this week`,
    `Relative words in earlier turns, summary, and memory are stale. NOW is the split: before = past, after = upcoming. Tool date args: this timezone, offset ${formatOffset(nowMs, zone)} — never Z / UTC unless the schema requires it.`,
  ].join("\n");
}

/** `{{+120m}}` → local `2:00PM`. The eval harness expands fixtures with this. */
export function expandEvalClock(text: string, nowMs: number, zone: string): string {
  return text.replace(/\{\{([+-]\d+)m\}\}/gu, (whole, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return whole;
    const p = parts(nowMs + n * 60_000, zone);
    return format12(p.hour, p.minute, false);
  });
}

function parts(ms: number, zone: string): Day & { hour: number; minute: number } {
  const p = localParts(ms, zone);
  const hour = p.hour === 24 ? 0 : p.hour;
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday, hour, minute: p.minute };
}

function shift(day: Day, n: number): Day {
  const utc = new Date(Date.UTC(day.year, day.month - 1, day.day + n));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    weekday: utc.getUTCDay(),
  };
}

function sunday(day: Day): Day {
  return shift(day, -day.weekday);
}

function iso(day: Day): string {
  return `${String(day.year)}-${pad(day.month)}-${pad(day.day)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function format12(hour: number, minute: number, space: boolean): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  let h = hour % 12;
  if (h === 0) h = 12;
  const gap = space ? " " : "";
  return `${String(h)}:${pad(minute)}${gap}${suffix}`;
}

function formatOffset(ms: number, zone: string): string {
  const off = zoneOffsetMs(ms, zone);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  return `${sign}${pad(h)}:${pad(m)}`;
}

function isUtcName(name: string): boolean {
  const n = name.trim();
  return n === "" || n.toLowerCase() === "utc" || n.toLowerCase() === "zulu";
}

function zoneAbbr(ms: number, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type === "timeZoneName") return part.value;
  }
  return zone;
}

function formatZone(ms: number, zone: string, tzName: string): string {
  const offset = formatOffset(ms, zone);
  if (isUtcName(tzName)) return `UTC (offset ${offset})`;
  const abbr = zoneAbbr(ms, zone);
  if (abbr !== "" && abbr !== tzName && !isUtcName(abbr) && !abbr.toUpperCase().startsWith("UTC")) {
    return `${abbr} (${tzName}, offset ${offset})`;
  }
  return `${tzName} (offset ${offset})`;
}

function dayPart(hour: number): { part: string; already: string[]; ahead: string[] } {
  let idx = 0;
  let name = SLOTS[0]?.name ?? "overnight";
  for (let i = 0; i < SLOTS.length; i += 1) {
    const s = SLOTS[i];
    if (s && hour >= s.lo && hour < s.hi) {
      idx = i;
      name = s.name;
      break;
    }
  }
  const already: string[] = [];
  const ahead: string[] = [];
  for (let i = 0; i < SLOTS.length; i += 1) {
    const s = SLOTS[i];
    if (!s) continue;
    if (i < idx) already.push(s.name);
    else if (i > idx) ahead.push(s.name);
  }
  return { part: name, already, ahead };
}

function dayPartCallout(name: string): string {
  if (name === "lunch") return "lunch window";
  if (name === "afternoon" || name === "evening" || name === "night") return `${name} (lunch is over)`;
  return `${name}, not lunch`;
}

function joinParts(partsList: readonly string[]): string {
  if (partsList.length === 0) return "none";
  return partsList.join(", ");
}

function formatWeek(today: Day): string {
  const start = sunday(today);
  const bits: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = shift(start, i);
    bits.push(`${WEEK_SHORT[d.weekday] ?? "Sun"} ${pad(d.month)}-${pad(d.day)} ${dayMark(d, today)}`);
  }
  return bits.join(" · ");
}

function dayMark(d: Day, today: Day): string {
  if (d.year === today.year && d.month === today.month && d.day === today.day) return "TODAY";
  const a = Date.UTC(d.year, d.month - 1, d.day);
  const b = Date.UTC(today.year, today.month - 1, today.day);
  return a < b ? "past" : "upcoming";
}

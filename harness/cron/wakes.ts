import { localParts } from "@/harness/core/clock";
import { KindDaily, KindEvery, KindOnce } from "./constants";
import type { Job } from "./types";

const wakesMax = 3;
const wakesClip = 40;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Per-turn `[wakes]` line: the next few human-facing jobs (once/daily/every),
 * soonest first. Planner, examples, and wait pokes are skipped. Empty if none.
 * Times render in `zone` (the human's clock, which is `now`'s zone in Go).
 */
export function formatWakes(jobs: Job[], now: number, zone: string): string {
  const human = new Set<string>([KindOnce, KindDaily, KindEvery]);
  const due = jobs.filter((j) => j.enabled && j.nextRunAt !== 0 && human.has(j.kind));
  if (due.length === 0) return "";
  due.sort((a, b) => a.nextRunAt - b.nextRunAt);
  let more = 0;
  let shown = due;
  if (due.length > wakesMax) {
    more = due.length - wakesMax;
    shown = due.slice(0, wakesMax);
  }
  const parts = shown.map((j) => {
    let part = whenShort(j.nextRunAt, now, zone);
    const prompt = clipWake(j.prompt);
    if (prompt) part += ` ${prompt}`;
    return part;
  });
  let line = `[wakes] ${parts.join(" · ")}`;
  if (more > 0) line += ` (+${more} more — cron_list)`;
  return line;
}

export function whenShort(at: number, now: number, zone: string): string {
  const a = localParts(at, zone);
  const n = localParts(now, zone);
  const clock = format12(a.hour === 24 ? 0 : a.hour, a.minute);
  if (a.year === n.year && a.month === n.month && a.day === n.day) return clock;
  const six = 6 * 24 * 60 * 60 * 1000;
  if (at - now < six && now - at < six) {
    const wd = weekdays[a.weekday] ?? "Sun";
    return `${wd} ${clock}`;
  }
  const mon = months[a.month - 1] ?? "Jan";
  return `${mon} ${a.day} ${clock}`;
}

function format12(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function clipWake(s: string): string {
  const collapsed = s.trim().split(/\s+/u).filter((part) => part !== "").join(" ");
  const chars = Array.from(collapsed);
  if (chars.length <= wakesClip) return collapsed;
  return `${chars.slice(0, wakesClip - 1).join("").trimEnd()}…`;
}

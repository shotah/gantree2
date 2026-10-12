/**
 * Per-turn `[agent]` stamps: hours, aims, todo, loops, wakes, surface,
 * input, and last contact. Hydration drops the rows already on those lines.
 */
import { localParts } from "@/harness/core/clock";
import { age } from "@/harness/here";
import {
  formatAimsEmpty,
  formatAimsNoted,
  formatLoops,
  formatTodo,
} from "@/harness/memory/horizon";
import { parseHours } from "@/harness/memory/hours";
import {
  KIND_FACT,
  KIND_INSIGHT,
  KIND_PREFERENCE,
  SUBJECT_AIM_BOOTSTRAP,
  SUBJECT_AIM_PREFIX,
  SUBJECT_FOLLOW_PREFIX,
  SUBJECT_HOURS,
  SUBJECT_TODO_PREFIX,
  SUBJECT_WAITING_PREFIX,
  type Entry,
} from "@/harness/memory/types";
import type { MemoryStore } from "@/harness/memory/store";
import type { AimStore } from "@/harness/aims/store";
import { suffix } from "@/harness/aims/text";
import type { Job } from "@/harness/cron/types";
import { formatWakes } from "@/harness/cron/wakes";
import { isDailyPlannerTurn } from "@/harness/cron/planner";

const SPOKEN = "read aloud like a person: conversational prose, a few short sentences, no markdown, lists, code, links, or emoji";

export type Horizon = {
  aims: Entry[];
  todo: Entry[];
  waiting: Entry[];
  follow: Entry[];
  asked: Entry | null;
};

export function loadHorizon(memory: MemoryStore): Horizon {
  const list = (kind: string, prefix: string): Entry[] => {
    try {
      return memory.listBySubjectPrefix(kind, prefix, 0);
    } catch {
      return [];
    }
  };
  const aims = list(KIND_INSIGHT, SUBJECT_AIM_PREFIX);
  let asked: Entry | null = null;
  if (aims.length === 0) {
    asked = memory.activeByKindSubject(KIND_FACT, SUBJECT_AIM_BOOTSTRAP);
  }
  return {
    aims,
    todo: list(KIND_FACT, SUBJECT_TODO_PREFIX),
    waiting: list(KIND_FACT, SUBJECT_WAITING_PREFIX),
    follow: list(KIND_FACT, SUBJECT_FOLLOW_PREFIX),
    asked,
  };
}

export function hoursLine(memory: MemoryStore): string {
  const row = memory.activeByKindSubject(KIND_PREFERENCE, SUBJECT_HOURS);
  return parseHours(row?.content ?? "").footer();
}

export function horizonStamp(
  h: Horizon,
  now: number,
  zone: string,
  aims: AimStore | null,
  userText: string,
): string {
  const notes = aimNotes(h, now, aims);
  let aimsLine = formatAimsNoted(h.aims, now, notes);
  if (aimsLine === "") aimsLine = formatAimsEmpty(h.asked, now, zone);
  const progress = aims && isDailyPlannerTurn(userText) ? progressLine(h, now, aims) : "";
  return [aimsLine, formatTodo(h.todo, now), progress, formatLoops(h.waiting, h.follow, now)]
    .filter((line) => line !== "")
    .map((line) => `\n${line}`)
    .join("");
}

export function dropStamped(h: Horizon, entries: readonly Entry[]): Entry[] {
  const stamped = new Set<number>();
  if (h.asked && h.asked.id > 0) stamped.add(h.asked.id);
  for (const set of [h.aims, h.todo, h.waiting, h.follow]) {
    for (const e of set) {
      if (e.id > 0) stamped.add(e.id);
    }
  }
  if (stamped.size === 0) return entries.slice();
  return entries.filter((e) => !stamped.has(e.id));
}

function aimNotes(h: Horizon, now: number, aims: AimStore | null): Record<string, string> | undefined {
  if (!aims) return undefined;
  const notes: Record<string, string> = {};
  let n = 0;
  for (const e of h.aims) {
    const area = e.subject.trim().slice(SUBJECT_AIM_PREFIX.length);
    if (area === "" || area === "bootstrap") continue;
    if (n >= 5) break;
    n += 1;
    try {
      const s = suffix(aims.statsAt(area, now));
      if (s !== "") notes[area] = s;
    } catch {
      // a missing ledger leaves the aim unlabeled
    }
  }
  return notes;
}

function progressLine(h: Horizon, now: number, aims: AimStore): string {
  const areas: string[] = [];
  for (const e of h.aims) {
    const area = e.subject.trim().slice(SUBJECT_AIM_PREFIX.length);
    if (area === "" || area === "bootstrap") continue;
    areas.push(area);
    if (areas.length >= 5) break;
  }
  try {
    return aims.progressText(areas, now);
  } catch {
    return "";
  }
}

export function wakesLine(jobs: readonly Job[], now: number, zone: string): string {
  return formatWakes(jobs.slice(), now, zone);
}

export function surfaceLine(surface: string): string {
  if (surface === "") return "";
  if (surface === "android_auto" || surface === "carplay") {
    return `[surface] ${surface} — driving; ${SPOKEN}`;
  }
  return `[surface] ${surface}`;
}

export function inputLine(input: string, surface: string): string {
  if (input === "") return "";
  if (surface === "android_auto" || surface === "carplay") return `[input] ${input}`;
  return `[input] ${input} — ${SPOKEN}`;
}

export function lastContactLine(at: number | null, now: number, zone: string): string {
  if (at == null) return "[last contact] none in this session — first message";
  return `[last contact] last human message ${age(now - at)} (${whenContact(at, now, zone)})`;
}

function whenContact(at: number, now: number, zone: string): string {
  const a = localParts(at, zone);
  const n = localParts(now, zone);
  const sameDay = a.year === n.year && a.month === n.month && a.day === n.day;
  if (sameDay) return clock12(a.hour === 24 ? 0 : a.hour, a.minute);
  if (Math.abs(at - now) < 6 * 86_400_000) {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${weekdays[a.weekday] ?? "Sun"} ${clock12(a.hour === 24 ? 0 : a.hour, a.minute)}`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[a.month - 1] ?? "Jan"} ${String(a.day)} ${clock12(a.hour === 24 ? 0 : a.hour, a.minute)}`;
}

function clock12(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${String(h)}:${String(minute).padStart(2, "0")} ${suffix}`;
}

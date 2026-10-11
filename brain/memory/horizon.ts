import { entryAt } from "./sort";
import { DAY_MS, localDay } from "./time";
import { sortTodo, todoWords } from "./todo";
import {
  SUBJECT_AIM_PREFIX,
  SUBJECT_TODO_PREFIX,
  type Entry,
} from "./types";

/** Lines on `[harness]`. Five shown; the rest are counted, not dropped silently. */
export const HORIZON_MAX = 5;
const HORIZON_CLIP = 72;
/** An open loop untouched this long gets a resolve-or-forget cue. */
const LOOP_STALE_MS = 21 * DAY_MS;

/** Per-turn `[aims]` line. Empty when there are no live `aim/` rows. `now` 0 omits ages. */
export function formatAims(entries: readonly Entry[] | null | undefined, now = 0): string {
  return formatAimsNoted(entries, now);
}

/**
 * `[aims]` with an optional rating suffix per area (`notes[area]`).
 * The five-aim cap still holds.
 */
export function formatAimsNoted(
  entries: readonly Entry[] | null | undefined,
  now = 0,
  notes?: Readonly<Record<string, string>>,
): string {
  const [parts, more] = horizonParts(entries ?? [], SUBJECT_AIM_PREFIX, now, 0);
  if (parts.length === 0) {
    return "";
  }
  if (notes && Object.keys(notes).length > 0) {
    const capped = (entries ?? []).slice(0, HORIZON_MAX);
    let i = 0;
    for (const e of capped) {
      const label = trimPrefix(e.subject.trim(), SUBJECT_AIM_PREFIX);
      if (label === "") {
        continue;
      }
      const note = notes[label]?.trim() ?? "";
      if (i < parts.length && note !== "") {
        parts[i] = `${parts[i]} — ${note}`;
      }
      i += 1;
    }
  }
  return `[aims] ${parts.join(" · ")}${horizonMore(more, "memory_recall aim/")}`;
}

/**
 * `[aims]` when the board is empty but the months-scale question was already
 * asked. The date is in `zone` when `now` is set, so "once per day" needs no
 * lookup. No timestamp keeps `none (asked)`. Null means the line stays absent.
 */
export function formatAimsEmpty(asked: Entry | null | undefined, now = 0, zone = "UTC"): string {
  if (!asked) {
    return "";
  }
  const at = asked.updatedAt !== 0 ? asked.updatedAt : asked.createdAt;
  if (at === 0) {
    return "[aims] none (asked)";
  }
  const loc = now !== 0 ? (zone || "UTC") : "UTC";
  return `[aims] none (asked ${localDay(at, loc)})`;
}

/**
 * `[loops]` for open waits and follows, interleaved so five waits cannot hide
 * every follow. Loops untouched for three weeks carry a resolve-or-forget cue.
 */
export function formatLoops(
  waiting: readonly Entry[] | null | undefined,
  follow: readonly Entry[] | null | undefined,
  now = 0,
): string {
  const [parts, more] = horizonParts(interleave(waiting ?? [], follow ?? []), "", now, LOOP_STALE_MS);
  if (parts.length === 0) {
    return "";
  }
  return `[loops] ${parts.join(" · ")}${horizonMore(more, "memory_recall waiting/ follow/")}`;
}

/**
 * `[todo]` line: urgent and high first, then oldest, each with its row id so
 * "done" is `memory_forget` by id. No stale cue — an undone task is still a task.
 */
export function formatTodo(entries: readonly Entry[] | null | undefined, now = 0): string {
  const [parts, more] = horizonParts(sortTodo(entries ?? []), SUBJECT_TODO_PREFIX, now, 0);
  if (parts.length === 0) {
    return "";
  }
  return `[todo] ${parts.join(" · ")}${horizonMore(more, "/todo")}`;
}

/** `(12d ago)` from `updated_at` (`created_at` fallback). Empty inside the first day. */
export function horizonAge(entry: Entry, now: number): string {
  return stampAge(entry, now, 0).trim();
}

function horizonMore(n: number, hint: string): string {
  if (n <= 0) {
    return "";
  }
  return ` (+${String(n)} more — ${hint})`;
}

function interleave(a: readonly Entry[], b: readonly Entry[]): Entry[] {
  const out: Entry[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const left = a[i];
    if (left) {
      out.push(left);
    }
    const right = b[i];
    if (right) {
      out.push(right);
    }
  }
  return out;
}

function horizonParts(
  entries: readonly Entry[],
  stripPrefix: string,
  now: number,
  staleAfterMs: number,
): [string[], number] {
  if (entries.length === 0) {
    return [[], 0];
  }
  let more = 0;
  let rows = entries;
  if (rows.length > HORIZON_MAX) {
    more = rows.length - HORIZON_MAX;
    rows = rows.slice(0, HORIZON_MAX);
  }
  const parts: string[] = [];
  for (const e of rows) {
    let label = e.subject.trim();
    if (stripPrefix !== "") {
      label = trimPrefix(label, stripPrefix);
    }
    if (label === "") {
      continue;
    }
    let part = label;
    let body = e.content;
    if (stripPrefix === SUBJECT_TODO_PREFIX) {
      body = todoWords(body);
      if (e.id > 0) {
        part = `#${String(e.id)} ${label}`;
      }
    }
    body = clipHorizon(body);
    if (body !== "") {
      part += `: ${body}`;
    }
    parts.push(part + stampAge(e, now, staleAfterMs));
  }
  return [parts, more];
}

function stampAge(entry: Entry, now: number, staleAfterMs: number): string {
  const at = entryAt(entry);
  if (at === 0 || now === 0) {
    return "";
  }
  const d = now - at;
  if (d < DAY_MS) {
    return "";
  }
  const days = Math.floor(d / DAY_MS);
  let s = ` (${String(days)}d ago`;
  if (staleAfterMs > 0 && d >= staleAfterMs) {
    s += " — resolve or memory_forget";
  }
  return `${s})`;
}

function clipHorizon(s: string): string {
  const flat = s.trim().split(/\s+/u).filter((part) => part !== "").join(" ");
  const chars = Array.from(flat);
  if (chars.length <= HORIZON_CLIP) {
    return flat;
  }
  return `${chars.slice(0, HORIZON_CLIP - 1).join("")}\u2026`;
}

function trimPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

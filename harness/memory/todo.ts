import { cleanTodoText, type TodoItem } from "@/lib/chat/todo";
import { localDay } from "./time";
import { entryAt, sortOldestFirst } from "./sort";
import { SUBJECT_TODO_PREFIX, type Entry } from "./types";

/** `!!` urgent, `!` high, bare words normal. Three or more bangs read as urgent. */
export const TODO_PRIORITY_NORMAL = 0;
export const TODO_PRIORITY_HIGH = 1;
export const TODO_PRIORITY_URGENT = 2;

/**
 * Phone slug (`lib/chat/todo.ts`). Longer than 32 characters is left out of
 * the frame; the row stays in memory.
 */
const TODO_SLUG = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** Leading marker and the words after it. */
export function todoPriority(content: string): { level: number; text: string } {
  const s = content.trim();
  let n = 0;
  while (n < s.length && s.charAt(n) === "!") {
    n += 1;
  }
  const level = n > TODO_PRIORITY_URGENT ? TODO_PRIORITY_URGENT : n;
  return { level, text: s.slice(n).trim() };
}

/** Marker for a level. Empty for normal or out of range. */
export function todoMarker(level: number): string {
  if (level === TODO_PRIORITY_HIGH) {
    return "!";
  }
  if (level === TODO_PRIORITY_URGENT) {
    return "!!";
  }
  return "";
}

/**
 * Content for a text view: marker, one space, the words. The marker stays
 * so the agent reading `[todo]` sees the stakes.
 */
export function todoWords(content: string): string {
  const split = todoPriority(content);
  const marker = todoMarker(split.level);
  if (marker === "") {
    return split.text;
  }
  if (split.text === "") {
    return marker;
  }
  return `${marker} ${split.text}`;
}

/** Urgent, then high, then normal; inside a level, oldest first. Input untouched. */
export function sortTodo(entries: readonly Entry[]): Entry[] {
  const out = sortOldestFirst(entries);
  out.sort((a, b) => todoPriority(b.content).level - todoPriority(a.content).level);
  return out;
}

/**
 * Live `todo/` rows for the phone drawer. Priority first, then oldest.
 * No cap (the `[todo]` stamp is what is capped). Off-pattern slugs and empty
 * text are dropped. `priority` is the wire's `"urgent" | "high"`; normal rows
 * omit it. The marker is not repeated in `text`.
 */
export function todoBoard(entries: readonly Entry[] | null | undefined, zone = "UTC"): TodoItem[] {
  const loc = zone || "UTC";
  const out: TodoItem[] = [];
  for (const e of sortTodo(entries ?? [])) {
    const slug = e.subject.trim().startsWith(SUBJECT_TODO_PREFIX)
      ? e.subject.trim().slice(SUBJECT_TODO_PREFIX.length)
      : e.subject.trim();
    if (!TODO_SLUG.test(slug)) {
      continue;
    }
    const split = todoPriority(e.content);
    const text = cleanTodoText(split.text);
    if (text === "") {
      continue;
    }
    const atMs = entryAt(e);
    const item: TodoItem = {
      id: e.id,
      slug,
      text,
      at: atMs === 0 ? "" : localDay(atMs, loc),
    };
    if (split.level === TODO_PRIORITY_URGENT) {
      item.priority = "urgent";
    } else if (split.level === TODO_PRIORITY_HIGH) {
      item.priority = "high";
    }
    out.push(item);
  }
  return out;
}

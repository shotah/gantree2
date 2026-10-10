import type { AimRow } from "@/lib/chat/aims";
import type { TodoItem } from "@/lib/chat/todo";

/**
 * What the human last looked at on a pushed board, key → row. A header
 * badge is a call to action — it counts rows that differ from this (new,
 * changed, or gone), never the size of the board. Opening the drawer
 * marks the current board seen. Kept on the device so the mailbox
 * replaying the same board on reconnect shows nothing.
 */

type Getter = { getItem(key: string): string | null };
type Setter = { setItem(key: string, value: string): void };

export type BoardSeen = Record<string, string>;

export function boardFingerprint<T>(rows: T[], keyOf: (row: T) => string): BoardSeen {
  return Object.fromEntries(rows.map((r) => [keyOf(r), JSON.stringify(r)]));
}

/** Rows that differ from what was last looked at: new, changed, or gone. */
export function changedRows<T>(rows: T[], seen: BoardSeen, keyOf: (row: T) => string): number {
  const now = boardFingerprint(rows, keyOf);
  let n = 0;
  for (const key of new Set([...Object.keys(now), ...Object.keys(seen)])) {
    if (now[key] !== seen[key]) {
      n += 1;
    }
  }
  return n;
}

/** Junk or missing → nothing seen, so a first board counts whole. */
export function boardSeenPref(storage: Getter | null | undefined, storeKey: string): BoardSeen {
  const raw = storage?.getItem(storeKey);
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function writeBoardSeenPref<T>(storage: Setter, storeKey: string, rows: T[], keyOf: (row: T) => string): BoardSeen {
  const seen = boardFingerprint(rows, keyOf);
  storage.setItem(storeKey, JSON.stringify(seen));
  return seen;
}

// Goals board: the area is the identity.
export const AIMS_SEEN_KEY = "gantree.aimsSeen";
export const aimKey = (a: AimRow): string => a.area;

// Tasks board: the slug is the identity — a rewrite changes the id, not the task.
export const TODO_SEEN_KEY = "gantree.todoSeen";
export const todoKey = (t: TodoItem): string => t.slug;

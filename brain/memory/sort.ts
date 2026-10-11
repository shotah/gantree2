import { type Entry } from "./types";

/** `updated_at`, falling back to `created_at`. `0` when both are unset. */
export function entryAt(entry: Entry): number {
  if (entry.updatedAt !== 0) {
    return entry.updatedAt;
  }
  return entry.createdAt;
}

/** Oldest first. The input is not modified. */
export function sortOldestFirst(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => entryAt(a) - entryAt(b));
}

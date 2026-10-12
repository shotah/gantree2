import {
  KIND_FACT,
  KIND_INSIGHT,
  KIND_PERSON,
  KIND_PREFERENCE,
  type Entry,
  type MemoryBackend,
} from "./types";

const MAX_PIN_WALK = 8;

const PIN_KINDS = [KIND_FACT, KIND_PREFERENCE, KIND_INSIGHT, KIND_PERSON];

/**
 * Live memory for a cron pin: follow `superseded_by` from `id`, then fall
 * back to `subject` across durable kinds. Null when nothing live matches.
 */
export function resolvePin(memory: MemoryBackend | null | undefined, id: number, subject: string): Entry | null {
  if (!memory) {
    return null;
  }
  if (id > 0) {
    try {
      return walkLive(memory, memory.get(id));
    } catch {
      // missing id falls through to the subject
    }
  }
  const key = subject.trim();
  if (key === "") {
    return null;
  }
  for (const kind of PIN_KINDS) {
    try {
      const entry = memory.activeByKindSubject(kind, key);
      if (entry) {
        return entry;
      }
    } catch {
      // not supported, or a lookup error — try the next kind
    }
  }
  return null;
}

function walkLive(memory: MemoryBackend, start: Entry): Entry {
  const seen = new Set<number>([start.id]);
  let cur = start;
  for (let i = 0; i < MAX_PIN_WALK; i += 1) {
    const nextId = cur.supersededBy;
    if (nextId === null || nextId === 0) {
      return cur;
    }
    if (seen.has(nextId)) {
      return cur;
    }
    let next: Entry;
    try {
      next = memory.get(nextId);
    } catch {
      return cur;
    }
    seen.add(nextId);
    cur = next;
  }
  return cur;
}

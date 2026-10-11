import type { MemoryLookup, MemoryPin } from "./types";

const pinKinds = ["fact", "preference", "insight", "person"];
const maxPinWalk = 8;

/** Follow `supersededBy` from id, then fall back to subject across durable kinds. */
export async function resolvePin(memory: MemoryLookup, id: number, subject: string): Promise<MemoryPin | null> {
  if (id > 0) {
    try {
      const row = await memory.get(id);
      if (row) return walkLive(memory, row);
    } catch {
      // A missing id falls through to the subject.
    }
  }
  const sub = subject.trim();
  if (!sub) return null;
  for (const kind of pinKinds) {
    try {
      const row = await memory.activeByKindSubject(kind, sub);
      if (row) return row;
    } catch {
      // Try the next durable kind.
    }
  }
  return null;
}

async function walkLive(memory: MemoryLookup, start: MemoryPin): Promise<MemoryPin> {
  const seen = new Set<number>([start.id]);
  let cur = start;
  for (let i = 0; i < maxPinWalk; i += 1) {
    const nextId = cur.supersededBy;
    if (nextId == null || nextId === 0) return cur;
    if (seen.has(nextId)) return cur;
    let next: MemoryPin | null;
    try {
      next = await memory.get(nextId);
    } catch {
      return cur;
    }
    if (!next) return cur;
    seen.add(nextId);
    cur = next;
  }
  return cur;
}

export function formatJobMemory(kind: string, subject: string, content: string): string {
  const k = kind.trim();
  const s = subject.trim();
  const c = content.trim();
  if (!c) return "";
  return `[job memory]\n- (${k}) ${s}: ${c}\n\n`;
}

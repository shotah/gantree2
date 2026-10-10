import { QUEUE_BYTES_MAX, QUEUE_MAX, QUEUE_TTL_MS } from "./caps";
import type { Role } from "./frame";

export const QUEUE_STORE_PREFIX = "q:";
export const QUEUE_SEQ_KEY = "queueSeq";
export const CURSOR_STORE_PREFIX = "c:";

export type Queued = {
  id: string;
  seq?: number;
  to: Role;
  body: string;
  at: number;
  userId?: string;
  kind?: string;
  bytes: number;
};

export function queueStoreKey(id: string, to: Role): string {
  return `${QUEUE_STORE_PREFIX}${to}:${id}`;
}

export function queueIdentity(item: Pick<Queued, "id" | "to">): string {
  return `${item.to}:${item.id}`;
}

export function cursorStoreKey(userId: string): string {
  return `${CURSOR_STORE_PREFIX}${userId}`;
}

/** Broadcast rows stay until TTL; only the owner may delete a targeted row. */
export function phoneMayDeleteQueued(item: Pick<Queued, "to" | "userId">, userId?: string): boolean {
  if (item.to !== "phone") {
    return false;
  }
  const owner = item.userId ?? "";
  if (!owner) {
    return false;
  }
  return owner === (userId ?? "");
}

export function seqForSince(items: readonly Queued[], since?: string): number | undefined {
  if (!since) {
    return undefined;
  }
  const hit = items.find((m) => m.id === since);
  if (hit?.seq != null) {
    return hit.seq;
  }
  if (/^[0-9]+$/.test(since)) {
    const n = Number(since);
    if (Number.isSafeInteger(n) && n >= 0) {
      return n;
    }
  }
  return undefined;
}

export function mergeCursor(current: number, ackSeq?: number): number {
  if (ackSeq == null || !Number.isFinite(ackSeq) || ackSeq < 0) {
    return current;
  }
  return Math.max(current, ackSeq);
}

export function afterCursor(item: Queued, opts: { since?: string; sinceSeq?: number }): boolean {
  if (opts.sinceSeq != null && item.seq != null) {
    return item.seq > opts.sinceSeq;
  }
  if (opts.since) {
    return item.id > opts.since;
  }
  return true;
}

export function dropAcked(items: Queued[], opts: { since?: string; userId?: string }): Queued[] {
  const uid = opts.userId ?? "";
  const sinceSeq = seqForSince(items, opts.since);
  return items.filter((m) => {
    if (!phoneMayDeleteQueued(m, uid)) {
      return true;
    }
    if (sinceSeq != null && m.seq != null) {
      return m.seq > sinceSeq;
    }
    if (opts.since) {
      return m.id > opts.since;
    }
    return true;
  });
}

export function shouldQueue(kind?: string): boolean {
  return kind !== "pin" && kind !== "ack" && kind !== "cmds" && kind !== "typing" && kind !== "draft" && kind !== "react" && kind !== "aims" && kind !== "todo";
}

export function destKey(to: Role, userId?: string): string {
  return `${to}:${userId ?? ""}`;
}

function destOf(item: Queued): string {
  return destKey(item.to, item.userId);
}

export function compareQueued(a: Pick<Queued, "seq" | "at" | "id">, b: Pick<Queued, "seq" | "at" | "id">): number {
  if (a.seq != null && b.seq != null && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  return a.at - b.at || a.id.localeCompare(b.id);
}

function older(a: Queued, b: Queued): boolean {
  return compareQueued(a, b) < 0;
}

function bytesOf(items: Queued[]): number {
  let n = 0;
  for (const m of items) {
    n += m.bytes;
  }
  return n;
}

/** Oldest non-reply first; replies only if nothing else remains. */
function evictIndex(mine: Queued[]): number {
  let bestNonReply = -1;
  let bestAny = -1;
  for (let i = 0; i < mine.length; i++) {
    const m = mine[i];
    if (!m) {
      continue;
    }
    if (bestAny < 0 || older(m, mine[bestAny])) {
      bestAny = i;
    }
    if (m.kind !== "reply" && (bestNonReply < 0 || older(m, mine[bestNonReply]))) {
      bestNonReply = i;
    }
  }
  return bestNonReply >= 0 ? bestNonReply : bestAny;
}

export function pruneQueue(items: Queued[], now: number, ttlMs = QUEUE_TTL_MS): Queued[] {
  return items.filter((m) => now - m.at <= ttlMs);
}

export function queuedFromList(rows: Iterable<[string, Queued]>): Queued[] {
  const items: Queued[] = [];
  for (const [, value] of rows) {
    items.push(value);
  }
  items.sort(compareQueued);
  return items;
}

export function enqueue(
  items: Queued[],
  msg: Queued,
  opts: { now: number; max?: number; ttlMs?: number; bytesMax?: number } = { now: Date.now() },
): Queued[] {
  const max = opts.max ?? QUEUE_MAX;
  const ttl = opts.ttlMs ?? QUEUE_TTL_MS;
  const cap = opts.bytesMax ?? QUEUE_BYTES_MAX;
  // Same (id, to) again is a replacement — one storage key, latest body.
  const same = queueIdentity(msg);
  const live = pruneQueue([...items.filter((m) => queueIdentity(m) !== same), msg], opts.now, ttl);
  const key = destOf(msg);
  const mine = live.filter((m) => destOf(m) === key);
  const keptMine = [...mine];
  while (keptMine.length > max || bytesOf(keptMine) > cap) {
    if (!keptMine.length) {
      break;
    }
    const i = evictIndex(keptMine);
    if (i < 0) {
      break;
    }
    keptMine.splice(i, 1);
  }
  const keep = new Set(keptMine.map((m) => m.id));
  return live.filter((m) => destOf(m) !== key || keep.has(m.id));
}

export function matchesFlush(item: Queued, to: Role, userId?: string): boolean {
  if (item.to !== to) {
    return false;
  }
  if (to === "crane") {
    return true;
  }
  const uid = item.userId ?? "";
  if (uid === "") {
    return true;
  }
  return userId != null && uid === userId;
}

export function peekFor(
  items: Queued[],
  to: Role,
  now: number,
  opts: { ttlMs?: number; userId?: string; since?: string; sinceSeq?: number } = {},
): Queued[] {
  const ttl = opts.ttlMs ?? QUEUE_TTL_MS;
  const live = pruneQueue(items, now, ttl);
  const sinceSeq = opts.sinceSeq ?? seqForSince(live, opts.since);
  return live.filter((m) => (
    matchesFlush(m, to, opts.userId) && afterCursor(m, { since: opts.since, sinceSeq })
  )).sort(compareQueued);
}

export function drainFor(
  items: Queued[],
  to: Role,
  now: number,
  ttlMs = QUEUE_TTL_MS,
  userId?: string,
): { kept: Queued[]; take: Queued[] } {
  const live = pruneQueue(items, now, ttlMs);
  const take = live.filter((m) => matchesFlush(m, to, userId)).sort(compareQueued);
  const kept = live.filter((m) => !matchesFlush(m, to, userId));
  return { kept, take };
}

export function newQueueId(now = Date.now(), rand = Math.random): string {
  return `${now.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

export const THREAD_MAX = 500;
export const SEEN_MAX = 500;

export type ThreadOrder = {
  id: string;
  at: number;
  seq?: number;
  kind?: string;
};

export type ThreadCursor = {
  id?: string;
  seq: number;
};

export function capThread<T>(messages: T[], max = THREAD_MAX): T[] {
  return messages.length > max ? messages.slice(-max) : messages;
}

/** Drop oldest ids first (Set insertion order) so a long-lived tab cannot grow forever. */
export function rememberSeen(seen: Set<string>, id: string, max = SEEN_MAX): void {
  seen.add(id);
  if (seen.size <= max) {
    return;
  }
  const extra = seen.size - max;
  let n = 0;
  for (const key of seen) {
    seen.delete(key);
    n += 1;
    if (n >= extra) {
      break;
    }
  }
}

export function isDraftBubble(m: Pick<ThreadOrder, "kind">): boolean {
  return m.kind === "draft";
}

/** Seq first, then mailbox time, then id. Drafts stay last so catch-up cannot leapfrog typing. */
export function compareThread(a: ThreadOrder, b: ThreadOrder): number {
  const aDraft = isDraftBubble(a);
  const bDraft = isDraftBubble(b);
  if (aDraft !== bDraft) {
    return aDraft ? 1 : -1;
  }
  if (a.seq != null && b.seq != null && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  if (a.at !== b.at) {
    return a.at - b.at;
  }
  return a.id.localeCompare(b.id);
}

export function placeInThread<T extends ThreadOrder>(messages: T[], bubble: T): T[] {
  const next = messages.filter((m) => m.id !== bubble.id);
  next.push(bubble);
  next.sort(compareThread);
  return next;
}

type Persistable = { id: string; kind?: string; pending?: boolean; live?: boolean };

/**
 * What is worth keeping on the device between loads: settled bubbles only.
 * A `sending` bubble either lands (the transcript replays it) or never did;
 * a draft is Kit mid-sentence. Neither should greet you as history.
 * `live` is a this-session React key so promoting draft→reply does not remount;
 * a reload must not keep it or the next draft steals that node's identity.
 */
export function persistableThread<T extends Persistable>(messages: T[]): T[] {
  return messages
    .filter((m) => !m.pending && !isDraftBubble(m))
    .map((m) => (m.live ? { ...m, live: false } : m));
}

/** Same bubbles in the same order — skip the write. */
export function sameThread<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/**
 * Fold the on-device copy under whatever the socket has already painted.
 * Live wins on an id clash: it carries the mailbox's latest `seq` / `at`.
 */
export function mergeThread<T extends ThreadOrder>(cached: readonly T[], live: readonly T[]): T[] {
  if (!cached.length) {
    return [...live];
  }
  const seen = new Set(live.map((m) => m.id));
  const next = [...live, ...cached.filter((m) => !seen.has(m.id))];
  next.sort(compareThread);
  return next;
}

/**
 * Highest mailbox `seq` on the cached thread, for the first `ack` `since` of a
 * fresh load. Bubbles the mailbox never stamped (refused sends) do not count.
 */
export function cursorOf<T extends ThreadOrder>(messages: readonly T[]): ThreadCursor {
  return messages.reduce<ThreadCursor>(
    (cur, m) => (m.seq == null ? cur : advanceCursor(cur, { id: m.id, seq: m.seq })),
    { seq: 0 },
  );
}

type Sendable = { id: string; from: "you" | "kit"; pending?: boolean; failed?: string };

/**
 * A mailbox `error` names the frame it refused when it can (`id`); older mailboxes and
 * parse failures cannot, so fall back to your newest bubble still marked `sending`.
 * Returns the same array when nothing was pending, so React skips the paint.
 */
export function failInThread<T extends Sendable>(messages: T[], id: string | undefined, why: string): T[] {
  const byId = id ? messages.findIndex((m) => m.id === id && m.from === "you") : -1;
  const at = byId >= 0
    ? byId
    : messages.reduce((last, m, i) => (m.from === "you" && m.pending ? i : last), -1);
  if (at < 0) {
    return messages;
  }
  return messages.map((m, i) => (i === at ? { ...m, pending: false, failed: why } : m));
}

export function advanceCursor(current: ThreadCursor, next: { id?: string; seq?: number }): ThreadCursor {
  if (next.seq != null && next.seq >= current.seq) {
    return { id: next.id ?? current.id, seq: next.seq };
  }
  if (next.seq == null && next.id) {
    return { id: next.id, seq: current.seq };
  }
  return current;
}

export function ackSince(cursor: ThreadCursor): string | undefined {
  if (cursor.seq > 0) {
    return String(cursor.seq);
  }
  return cursor.id;
}

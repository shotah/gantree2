import { TRANSCRIPT_BYTES_MAX, TRANSCRIPT_MAX } from "./caps";
import { compareQueued, type Queued } from "./queue";

export const TRANSCRIPT_STORE_PREFIX = "t:";
/** Broadcast cron `push` with no `user_id` lives here; hydrate merges it per phone. */
export const TRANSCRIPT_BROADCAST = "_";

export function transcriptStoreKey(userId?: string): string {
  const owner = (userId ?? "").trim() || TRANSCRIPT_BROADCAST;
  return TRANSCRIPT_STORE_PREFIX + owner;
}

/** Bubbles only. Ack still deletes the unread queue; this list is the reload thread. */
export function shouldTranscript(kind?: string): boolean {
  return kind === "inbound" || kind === "reply" || kind === "push";
}

function bytesOf(items: readonly Queued[]): number {
  let n = 0;
  for (const m of items) {
    n += m.bytes;
  }
  return n;
}

export function asTranscript(raw: unknown): Queued[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Queued[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const m = row as Queued;
    if (typeof m.id !== "string" || !m.id || typeof m.body !== "string") {
      continue;
    }
    if (m.to !== "phone" && m.to !== "crane") {
      continue;
    }
    if (typeof m.at !== "number" || !Number.isFinite(m.at)) {
      continue;
    }
    const bytes = typeof m.bytes === "number" && Number.isFinite(m.bytes) ? m.bytes : m.body.length;
    out.push({ ...m, bytes });
  }
  return out.sort(compareQueued);
}

/** Oldest first, regardless of kind. Photos count against the byte cap. */
export function appendTranscript(
  items: readonly Queued[],
  msg: Queued,
  opts: { max?: number; bytesMax?: number } = {},
): Queued[] {
  const max = opts.max ?? TRANSCRIPT_MAX;
  const cap = opts.bytesMax ?? TRANSCRIPT_BYTES_MAX;
  const next = [...items.filter((m) => m.id !== msg.id), msg].sort(compareQueued);
  const kept = [...next];
  while (kept.length > max || bytesOf(kept) > cap) {
    if (!kept.length) {
      break;
    }
    kept.shift();
  }
  return kept;
}

/** Personal rows win on id collision. Broadcasts (no `user_id`) sit in the same thread. */
export function hydrateTranscript(
  personal: readonly Queued[],
  broadcasts: readonly Queued[] = [],
): Queued[] {
  const byId = new Map<string, Queued>();
  for (const m of broadcasts) {
    byId.set(m.id, m);
  }
  for (const m of personal) {
    byId.set(m.id, m);
  }
  return [...byId.values()].sort(compareQueued);
}

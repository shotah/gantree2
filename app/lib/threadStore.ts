import type { ChatBubble } from "@/app/components/chat/Thread";
import { kvGet, kvSet } from "./kv";

/**
 * The last thread, on the device, so a reopened tab paints history before the
 * socket is up. One row per room per signed-in human — Ada's key is not Bob's.
 * The mailbox transcript stays the source of truth: it replays on connect and
 * `mergeThread` lets live frames win. This is the paint, not the record.
 */

export function threadCacheKey(slug: string, sub?: string): string {
  return `thread:${slug}:${sub ?? ""}`;
}

function isBubble(v: unknown): v is ChatBubble {
  if (!v || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  return typeof o.id === "string"
    && o.id.length > 0
    && (o.from === "you" || o.from === "kit")
    && typeof o.text === "string"
    && typeof o.at === "number"
    && Number.isFinite(o.at);
}

/** Junk or a missing row reads as an empty thread; a bad element is dropped, not fatal. */
export async function loadThread(key: string): Promise<ChatBubble[]> {
  const raw = await kvGet<unknown>(key);
  return Array.isArray(raw) ? raw.filter(isBubble) : [];
}

export async function saveThread(key: string, messages: readonly ChatBubble[]): Promise<void> {
  await kvSet(key, messages);
}

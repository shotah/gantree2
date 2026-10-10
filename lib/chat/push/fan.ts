import { displaySlug } from "@/lib/chat/slug";
import { notifyBody, NOTIFY_PUSH_TEST, NOTIFY_TAG, type NotifyPayload, type PushTestCounts } from "./payload";
import { PushSend, type PushSendOutcome, type PushSendResult } from "./send";
import type { PushSub, StoredPush } from "./subscription";
import { shouldWebPush, webPushUserIds } from "./target";

export function pushPayload(
  frame: { text?: string; images?: { url?: string }[] },
  title: string,
): NotifyPayload {
  return {
    title: displaySlug(title),
    body: notifyBody(frame.text, Boolean(frame.images?.[0]?.url)),
    tag: NOTIFY_TAG,
  };
}

export async function fanWebPush(opts: {
  frame: { kind?: string; text?: string; images?: { url?: string }[]; user_id?: string };
  title: string;
  stored: readonly StoredPush[];
  send: (subscription: PushSub, payload: NotifyPayload) => Promise<PushSendResult>;
}): Promise<{ gone: StoredPush[] }> {
  if (!shouldWebPush(opts.frame.kind)) {
    return { gone: [] };
  }
  const want = new Set(webPushUserIds({
    frameUserId: opts.frame.user_id,
    storedUserIds: opts.stored.map((row) => row.userId),
  }));
  if (want.size === 0) {
    return { gone: [] };
  }
  const payload = pushPayload(opts.frame, opts.title);
  const gone: StoredPush[] = [];
  for (const row of opts.stored) {
    if (!want.has(row.userId)) {
      continue;
    }
    const result = await opts.send(row.subscription, payload);
    if (result === PushSend.Gone) {
      gone.push(row);
    }
  }
  return { gone };
}

/**
 * Round-trip test for one human: push a real card to every subscription the
 * room holds for them and say what the push service answered. The counts
 * are the Settings hint; `gone` rows are for the caller to purge.
 */
export async function testWebPush(opts: {
  title: string;
  stored: readonly StoredPush[];
  send: (subscription: PushSub, payload: NotifyPayload) => Promise<PushSendOutcome>;
}): Promise<{ counts: PushTestCounts; gone: StoredPush[] }> {
  const payload: NotifyPayload = { ...NOTIFY_PUSH_TEST, title: displaySlug(opts.title) };
  const counts: PushTestCounts = { rows: opts.stored.length, ok: 0, gone: 0, fail: 0, statuses: [] };
  const gone: StoredPush[] = [];
  for (const row of opts.stored) {
    const outcome = await opts.send(row.subscription, payload);
    if (outcome.result === PushSend.Ok) {
      counts.ok += 1;
    } else if (outcome.result === PushSend.Gone) {
      counts.gone += 1;
      gone.push(row);
    } else {
      counts.fail += 1;
      if (outcome.status) {
        counts.statuses.push(outcome.status);
      }
    }
  }
  return { counts, gone };
}

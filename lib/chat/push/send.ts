import { buildPushHTTPRequest } from "@pushforge/builder";
import { NOTIFY_ICON, NOTIFY_TAG, type NotifyPayload } from "./payload";
import { QUEUE_TTL_MS } from "@/lib/chat/caps";
import type { PushSub } from "./subscription";
import type { VapidCreds } from "./vapid";

/** What the push service said. `Gone` (404 / 410) means drop the subscription. */
export const PushSend = {
  Ok: "ok",
  Gone: "gone",
  Fail: "fail",
} as const;
export type PushSendResult = typeof PushSend[keyof typeof PushSend];

/** `status` is the push service's answer when there was one — 403 is the VAPID-mismatch tell. */
export type PushSendOutcome = { result: PushSendResult; status?: number };

export const PUSH_TTL_SEC = Math.floor(QUEUE_TTL_MS / 1000);

export type PushSendOpts = {
  vapid: VapidCreds;
  subscription: PushSub;
  payload: NotifyPayload;
  fetch: typeof fetch;
};

export async function sendWebPush(opts: PushSendOpts): Promise<PushSendResult> {
  return (await sendWebPushDetailed(opts)).result;
}

export async function sendWebPushDetailed(opts: PushSendOpts): Promise<PushSendOutcome> {
  let endpoint: string;
  let headers: HeadersInit;
  let body: BodyInit;
  try {
    const built = await buildPushHTTPRequest({
      privateJWK: opts.vapid.privateJwk,
      subscription: opts.subscription,
      message: {
        payload: {
          title: opts.payload.title,
          body: opts.payload.body,
          tag: opts.payload.tag ?? NOTIFY_TAG,
          icon: opts.payload.icon ?? NOTIFY_ICON,
          badge: NOTIFY_ICON,
          ...(opts.payload.test ? { test: true } : {}),
        },
        adminContact: opts.vapid.subject,
        options: { ttl: PUSH_TTL_SEC, urgency: "high" },
      },
    });
    endpoint = built.endpoint;
    headers = built.headers;
    body = built.body;
  } catch {
    return { result: PushSend.Fail };
  }
  try {
    const res = await opts.fetch(endpoint, { method: "POST", headers, body });
    if (res.status === 404 || res.status === 410) {
      return { result: PushSend.Gone, status: res.status };
    }
    if (res.status >= 200 && res.status < 300) {
      return { result: PushSend.Ok, status: res.status };
    }
    return { result: PushSend.Fail, status: res.status };
  } catch {
    return { result: PushSend.Fail };
  }
}

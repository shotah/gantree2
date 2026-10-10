/** Lock-screen card the push service delivers. The service worker paints `tag`. */

export type NotifyPayload = {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
  /** A round-trip test: the service worker shows it even with a window in front. */
  test?: true;
};

export type PushTestCounts = {
  rows: number;
  ok: number;
  gone: number;
  fail: number;
  statuses: number[];
};

export const NOTIFY_ICON = "/icon-192.png";
/** Was `pendant`. New cards group under `chat`. */
export const NOTIFY_TAG = "chat";

export const NOTIFY_PUSH_TEST: NotifyPayload = {
  title: "chat",
  body: "Lock-screen push is on.",
  test: true,
};

const BODY_MAX = 140;

export function notifyBody(text: string | undefined, photo?: boolean): string {
  const t = text?.trim() ?? "";
  if (t) {
    return t.length > BODY_MAX ? `${t.slice(0, BODY_MAX - 1)}…` : t;
  }
  return photo ? "Photo" : "New message";
}

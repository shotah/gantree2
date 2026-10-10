/**
 * Lock-screen push, as the Settings row reports it. The local "Test" toast
 * proves permission and the service worker; only a round trip through the
 * Worker and the push service proves the pipe. Every step used to fail
 * silently — these names are what the row says instead.
 */

/** How registering this browser for lock-screen push ended. */
export const PushRegister = {
  Ok: "ok",
  NoPermission: "no-permission",
  NoPushApi: "no-push-api",
  /** `GET /api/chat/push` 404: the Worker has no VAPID keys. */
  NoVapid: "no-vapid",
  Unauthorized: "unauthorized",
  /** The Worker refused the subscription (endpoint host, shape). */
  Rejected: "rejected",
  Failed: "failed",
} as const;
export type PushRegisterResult = typeof PushRegister[keyof typeof PushRegister];

/** Why a round-trip test never left the Worker. */
export const PushTestFail = {
  NoVapid: "no-vapid",
  Unauthorized: "unauthorized",
  Failed: "failed",
} as const;
export type PushTestFailure = typeof PushTestFail[keyof typeof PushTestFail];

export type PushTestCounts = {
  /** Subscriptions the Worker holds for you in this room. */
  rows: number;
  ok: number;
  /** Push service said 404 / 410; the Worker dropped the row. */
  gone: number;
  fail: number;
  /** HTTP statuses behind `fail`, for the hint. */
  statuses: number[];
};

export type PushTestResult = PushTestCounts | PushTestFailure;

/** The browser holds a subscription for a different VAPID key: re-subscribe or every send is a 403. */
export function sameServerKey(existing: ArrayBuffer | null | undefined, want: Uint8Array): boolean {
  if (!existing) {
    return false;
  }
  const have = new Uint8Array(existing);
  if (have.byteLength !== want.byteLength) {
    return false;
  }
  for (let i = 0; i < have.byteLength; i += 1) {
    if (have[i] !== want[i]) {
      return false;
    }
  }
  return true;
}

export function pushRegisterHint(result: PushRegisterResult): string {
  switch (result) {
    case PushRegister.Ok:
      return "";
    case PushRegister.NoPermission:
      return "Notifications are not granted.";
    case PushRegister.NoPushApi:
      return "This browser has no Web Push.";
    case PushRegister.NoVapid:
      return "This Worker has no VAPID keys — local toasts only.";
    case PushRegister.Unauthorized:
      return "Sign in with Google first.";
    case PushRegister.Rejected:
      return "The Worker refused this subscription.";
    default:
      return "Could not reach the Worker.";
  }
}

export function parsePushTestCounts(raw: unknown): PushTestCounts | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const statuses = Array.isArray(o.statuses) ? o.statuses.filter((s): s is number => typeof s === "number") : [];
  return { rows: n(o.rows), ok: n(o.ok), gone: n(o.gone), fail: n(o.fail), statuses };
}

export function pushTestHint(result: PushTestResult): string {
  if (result === PushTestFail.NoVapid) {
    return "Local toast only — this Worker has no VAPID keys, so nothing reaches a locked phone.";
  }
  if (result === PushTestFail.Unauthorized) {
    return "Sign in with Google first.";
  }
  if (result === PushTestFail.Failed) {
    return "Could not reach the Worker.";
  }
  if (result.rows === 0) {
    return "No lock-screen subscription for this room — tap Enable again.";
  }
  if (result.ok > 0) {
    const n = result.ok === 1 ? "1 device" : `${result.ok} devices`;
    return `Lock-screen ping sent to ${n}. If nothing showed, the browser dropped it.`;
  }
  if (result.gone > 0 && result.fail === 0) {
    return "That subscription had expired — tap Enable again.";
  }
  if (result.statuses.includes(403) || result.statuses.includes(401)) {
    return "Push service refused (VAPID keys do not match this subscription) — tap Enable again.";
  }
  const status = result.statuses[0];
  return status ? `Push service refused (${status}).` : "Could not build the push.";
}

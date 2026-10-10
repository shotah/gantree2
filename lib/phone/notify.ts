/** Local OS toasts while the socket is up. Web Push (VAPID) is the lock-screen path. */

export type NotifyPermission = NotificationPermission | "unsupported";

export type NotifyPayload = {
  title: string;
  body: string;
  tag?: string;
  icon?: string;
  /** A round-trip test: the service worker shows it even with a window in front. */
  test?: true;
};

export type NotifyApi = {
  permission?: unknown;
  requestPermission?: () => unknown;
};

export type NotifyShower = {
  showNotification?: (title: string, opts?: NotificationOptions) => Promise<void> | void;
};

export type NotifyCtor = new (title: string, opts?: NotificationOptions) => unknown;

export const NOTIFY_ICON = "/icon-192.png";
export const NOTIFY_TAG = "gantree";
export const NOTIFY_TEST: NotifyPayload = {
  title: "gantree",
  body: "Notifications are on.",
};

/** What the Worker pushes for `POST /api/chat/push` — proves the whole pipe, not just the toast. */
export const NOTIFY_PUSH_TEST: NotifyPayload = {
  title: "gantree",
  body: "Lock-screen push is on.",
  test: true,
};

const BODY_MAX = 140;

export function readNotifyPermission(api: NotifyApi | null | undefined): NotifyPermission {
  if (!api) {
    return "unsupported";
  }
  const value = api.permission;
  if (value === "granted" || value === "denied" || value === "default") {
    return value;
  }
  return "unsupported";
}

export function notifyNeedHomeScreen(ios: boolean, standalone: boolean): boolean {
  return ios && !standalone;
}

/**
 * Gecko (Zen) often reports `Notification.permission` denied before this
 * origin has been asked. Granted is real. Only `requestPermission` is a real no.
 */
export function notifyAskState(os: NotifyPermission, asked: boolean): NotifyPermission {
  if (os === "granted") {
    return "granted";
  }
  if (os === "unsupported") {
    return "unsupported";
  }
  if (asked && os === "denied") {
    return "denied";
  }
  return "default";
}

export function notifyHint(opts: {
  permission: NotifyPermission;
  needHomeScreen: boolean;
}): string {
  if (opts.needHomeScreen) {
    return "Install the app first, then enable.";
  }
  if (opts.permission === "unsupported") {
    return "Not available in this browser.";
  }
  if (opts.permission === "denied") {
    return "Blocked — enable in system settings.";
  }
  return "";
}

/** Unread lock-screen toast while the thread is hidden. Push and replies only. */
export function shouldNotify(
  hidden: boolean,
  kind: string | undefined,
  permission: NotifyPermission,
  replay = false,
): boolean {
  return !replay && permission === "granted" && hidden && (kind === "push" || kind === "reply");
}

export function notifyBody(text: string | undefined, photo?: boolean): string {
  const t = text?.trim() ?? "";
  if (t) {
    return t.length > BODY_MAX ? `${t.slice(0, BODY_MAX - 1)}…` : t;
  }
  return photo ? "Photo" : "New message";
}

export async function requestNotifyPermission(api: NotifyApi | null | undefined): Promise<NotifyPermission> {
  if (!api || typeof api.requestPermission !== "function") {
    return "unsupported";
  }
  try {
    const result = await Promise.resolve(api.requestPermission());
    if (result === "granted" || result === "denied" || result === "default") {
      return result;
    }
  } catch {
    // keep whatever the OS already recorded
  }
  const current = readNotifyPermission(api);
  return current === "unsupported" ? "denied" : current;
}

export async function presentNotify(
  payload: NotifyPayload,
  opts: {
    permission: NotifyPermission;
    registration?: NotifyShower | null;
    Notification?: NotifyCtor;
  },
): Promise<boolean> {
  if (opts.permission !== "granted") {
    return false;
  }
  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag ?? NOTIFY_TAG,
    icon: payload.icon ?? NOTIFY_ICON,
    badge: NOTIFY_ICON,
  };
  try {
    if (typeof opts.registration?.showNotification === "function") {
      await opts.registration.showNotification(payload.title, options);
      return true;
    }
  } catch {
    // constructor fallback
  }
  try {
    if (opts.Notification) {
      new opts.Notification(payload.title, options);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

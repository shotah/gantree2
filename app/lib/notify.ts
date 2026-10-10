import {
  notifyBody,
  presentNotify,
  readNotifyPermission,
  requestNotifyPermission,
  shouldNotify,
  type NotifyPayload,
  type NotifyPermission,
} from "@/lib/phone/notify";

function notificationApi(): typeof Notification | undefined {
  if (typeof Notification === "undefined") {
    return undefined;
  }
  return Notification;
}

export function notifyPermission(): NotifyPermission {
  return readNotifyPermission(notificationApi());
}

export async function browserAskNotify(): Promise<NotifyPermission> {
  return requestNotifyPermission(notificationApi());
}

export async function browserShowNotify(payload: NotifyPayload): Promise<boolean> {
  const permission = notifyPermission();
  let registration: {
    showNotification?: (title: string, opts?: NotificationOptions) => Promise<void>;
  } | null = null;
  if (typeof navigator !== "undefined" && navigator.serviceWorker) {
    try {
      registration = (await navigator.serviceWorker.getRegistration("/")) ?? null;
    } catch {
      registration = null;
    }
  }
  return presentNotify(payload, {
    permission,
    registration,
    Notification: notificationApi(),
  });
}

/**
 * Close every card this app has in the tray — the thread is on screen here,
 * or another mouth said `seen`. Returns how many went. Tray cards are the
 * service worker's (Web Push and local toasts both go through it).
 */
export async function browserCloseShownNotify(): Promise<number> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    return 0;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg || typeof reg.getNotifications !== "function") {
      return 0;
    }
    const shown = await reg.getNotifications();
    for (const n of shown) {
      n.close();
    }
    return shown.length;
  } catch {
    return 0;
  }
}

export function browserNotifyIncoming(opts: {
  kind?: string;
  title: string;
  text?: string;
  photo?: boolean;
  replay?: boolean;
}): void {
  if (typeof document === "undefined") {
    return;
  }
  if (!shouldNotify(document.hidden, opts.kind, notifyPermission(), opts.replay === true)) {
    return;
  }
  void browserShowNotify({
    title: opts.title,
    body: notifyBody(opts.text, opts.photo),
  });
}

/** Lock-screen Web Push for crane push/reply. A live socket is not awake. */

export function shouldWebPush(kind?: string): boolean {
  return kind === "push" || kind === "reply";
}

export function webPushUserIds(opts: {
  frameUserId?: string;
  storedUserIds: readonly string[];
}): string[] {
  const want = opts.frameUserId
    ? [opts.frameUserId]
    : [...new Set(opts.storedUserIds.filter(Boolean))];
  return want.filter(Boolean);
}

/** Skip the tray when a controlled window is in front (Chrome silent-push exception). */
export function windowBlocksPushToast(
  clients: readonly { visibilityState?: string }[],
): boolean {
  return clients.some((c) => c.visibilityState === "visible");
}

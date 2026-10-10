export type BadgeApi = {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Unread count while the thread is hidden. Push and replies only. */
export function shouldBadge(hidden: boolean, kind: string | undefined): boolean {
  return hidden && (kind === "push" || kind === "reply");
}

export function bumpBadge(count: number, api: BadgeApi | null | undefined): number {
  const n = count + 1;
  try {
    void api?.setAppBadge?.(n);
  } catch {
    // no badge
  }
  return n;
}

export function clearBadgeCount(api: BadgeApi | null | undefined): 0 {
  try {
    void api?.clearAppBadge?.();
  } catch {
    // no badge
  }
  return 0;
}

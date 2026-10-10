/** Short buzz for an inbound cron ping while the document is visible. */
export function buzzPush(opts: {
  kind?: string;
  hidden: boolean;
  vibrate?: (pattern: number | number[]) => boolean;
}): void {
  if (opts.kind !== "push" || opts.hidden || !opts.vibrate) {
    return;
  }
  try {
    opts.vibrate(40);
  } catch {
    // no haptic
  }
}

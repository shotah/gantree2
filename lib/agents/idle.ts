/** Wall-clock idle window before an agent is stopped for lack of human messages. */
export const USER_IDLE_MS = 48 * 60 * 60 * 1000;

export const DEFAULT_IDLE_HOURS = 48;
export const IDLE_HOURS_MIN = 1;
export const IDLE_HOURS_MAX = 8760;

/** Stored config value → whole hours used for idle (invalid or null → default). */
export function idleHoursOf(stored: number | null | undefined): number {
  if (stored == null) {
    return DEFAULT_IDLE_HOURS;
  }
  if (!Number.isInteger(stored) || stored < IDLE_HOURS_MIN || stored > IDLE_HOURS_MAX) {
    return DEFAULT_IDLE_HOURS;
  }
  return stored;
}

/**
 * When to stop for user idle and when to wake for the next idle check.
 * `since` is the later of the last human message and the idle anchor (re-enable).
 */
export function idleClock(
  lastUserAt: number | null,
  anchorMs: number,
  now: number,
  idleMs = USER_IDLE_MS,
): { stop: boolean; wakeAt: number } {
  const since = Math.max(lastUserAt ?? 0, anchorMs);
  const wakeAt = since + idleMs;
  return { stop: now >= wakeAt, wakeAt };
}

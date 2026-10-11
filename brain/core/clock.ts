/**
 * Time is injected. The brain never calls `Date.now()` directly so a test can
 * sit at 07:10 in Denver and a cron can fire on the dot.
 */
export type Clock = {
  /** ms since epoch. */
  now(): number;
  /** IANA zone the human lives in (`America/Denver`). `UTC` when unknown. */
  zone: string;
};

export const systemClock = (zone = "UTC"): Clock => ({ now: () => Date.now(), zone });

/** Starts at `at`, moves only when told. */
export function fixedClock(at: number, zone = "UTC"): Clock & { set(at: number): void; tick(ms: number): void } {
  let t = at;
  return {
    zone,
    now: () => t,
    set: (next) => {
      t = next;
    },
    tick: (ms) => {
      t += ms;
    },
  };
}

/** Wall-clock parts of `ms` in `zone`, via Intl — no library, no DST table. */
export function localParts(ms: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    parts[p.type] = p.value;
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays.indexOf(parts.weekday ?? "Sun"),
  };
}

/** The ms offset of `zone` from UTC at instant `ms` (positive east of UTC). */
export function zoneOffsetMs(ms: number, zone: string): number {
  const p = localParts(ms, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms for wall-clock `hh:mm` on the local calendar day containing `ms` in `zone`. */
export function atLocalTime(ms: number, zone: string, hour: number, minute: number): number {
  const p = localParts(ms, zone);
  const guess = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0) - zoneOffsetMs(ms, zone);
  // DST edge: re-derive the offset at the guessed instant.
  return Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0) - zoneOffsetMs(guess, zone);
}

import { KindExamples } from "./constants";
import type { Parsed } from "./types";
import { addCalendarDays, atLocalHour, canonicalZone, formatRfc3339Nano, pad2 } from "./time";

export type Spread = {
  min: number;
  max: number;
  /** Local hour. The window is [startHour:00, endHour:00). */
  startHour: number;
  endHour: number;
};

export function parseQty(raw: string): { min: number; max: number } {
  const s = raw.trim();
  if (!s) throw new Error("cron: empty qty");
  let min: number;
  let max: number;
  const dash = s.indexOf("-");
  if (dash >= 0) {
    const a = strictInt(s.slice(0, dash));
    const b = strictInt(s.slice(dash + 1));
    if (a == null || b == null) throw new Error(`cron: bad qty ${JSON.stringify(s)}`);
    min = a;
    max = b;
  } else {
    const n = strictInt(s);
    if (n == null) throw new Error(`cron: bad qty ${JSON.stringify(s)}`);
    min = n;
    max = n;
  }
  if (min < 1 || max < min || max > 24) {
    throw new Error(`cron: qty must be 1–24 with min<=max, got ${min}-${max}`);
  }
  return { min, max };
}

export function parseSpread(exprRaw: string): Spread {
  const expr = exprRaw.trim();
  const parts = expr.split("@");
  if (parts.length !== 2) throw new Error(`cron: bad spread ${JSON.stringify(expr)} (want qty@HH-HH)`);
  const qty = parseQty(parts[0] ?? "");
  const hours = (parts[1] ?? "").split("-");
  if (hours.length !== 2) throw new Error(`cron: bad spread ${JSON.stringify(parts[1] ?? "")}`);
  const start = strictInt(hours[0] ?? "");
  if (start == null) throw new Error("cron: bad start hour");
  const end = strictInt(hours[1] ?? "");
  if (end == null) throw new Error("cron: bad end hour");
  if (start < 0 || start > 23 || end < 1 || end > 24 || end <= start) {
    throw new Error(`cron: window must be start 0–23, end 1–24, end>start (got ${start}-${end})`);
  }
  return { min: qty.min, max: qty.max, startHour: start, endHour: end };
}

export function formatSpread(q: Spread): string {
  return `${q.min}-${q.max}@${pad2(q.startHour)}-${pad2(q.endHour)}`;
}

/** Next window start: today if still before it, otherwise tomorrow. */
export function planSpreadNext(q: Spread, zone: string, now: number): number {
  const loc = zone.trim() ? canonicalZone(zone) : "UTC";
  const startToday = atLocalHour(now, loc, q.startHour);
  if (now < startToday) return startToday;
  return addCalendarDays(startToday, loc, 1);
}

/** Rolls qty in [min, max] and picks that many times across the remaining window. */
export function planSpreadTimes(q: Spread, zone: string, now: number): { n: number; times: number[] } {
  const loc = zone.trim() ? canonicalZone(zone) : "UTC";
  const start = atLocalHour(now, loc, q.startHour);
  const end = atLocalHour(now, loc, q.endHour);
  if (end <= start) throw new Error("cron: empty window");
  let lo = start;
  if (now > lo) lo = now + 60_000;
  if (end <= lo) return { n: 0, times: [] };

  let n = rollQty(q.min, q.max);
  const span = end - lo;
  let slot = Math.trunc(span / n);
  if (slot < 60_000) {
    let maxFit = Math.trunc(span / 60_000);
    if (maxFit < 1) maxFit = 1;
    if (n > maxFit) n = maxFit;
    if (n < q.min) {
      n = q.min;
      if (n > maxFit && maxFit >= 1) n = maxFit;
    }
    slot = Math.trunc(span / n);
    if (slot < 1000) slot = 1000;
  }

  const times: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const slotLo = lo + slot * i;
    let slotHi = slotLo + slot;
    if (i === n - 1 || slotHi > end) slotHi = end;
    if (slotHi <= slotLo) {
      times.push(slotLo);
      continue;
    }
    times.push(randBetween(slotLo, slotHi));
  }
  times.sort((a, b) => a - b);
  return { n, times };
}

function rollQty(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randBetween(lo: number, hi: number): number {
  if (hi <= lo) return lo;
  const sec = Math.trunc((hi - lo) / 1000);
  if (sec <= 1) return lo;
  return lo + Math.floor(Math.random() * sec) * 1000;
}

/**
 * Planner job of `kind`. `when` is "5", "1-2", or "1-2@06-21".
 * A bare qty uses startHour/endHour, or 6–21 when those are empty.
 */
export function parseSpreadSchedule(
  kind: string,
  whenRaw: string,
  startHour: number,
  endHour: number,
  zone: string,
  now: number,
): Parsed {
  const k = kind.trim();
  if (!k) throw new Error("cron: spread kind is required");
  const when = whenRaw.trim();
  let spec: Spread;
  if (when.includes("@")) {
    try {
      spec = parseSpread(when);
    } catch (err) {
      throw new Error(`cron: spread: ${message(err)}`, { cause: err });
    }
  } else {
    let qty: { min: number; max: number };
    try {
      qty = parseQty(when);
    } catch (err) {
      throw new Error(`cron: spread: ${message(err)}`, { cause: err });
    }
    let start = startHour;
    let end = endHour;
    if (start < 0 || end <= start) {
      start = 6;
      end = 21;
    }
    spec = { min: qty.min, max: qty.max, startHour: start, endHour: end };
  }
  const loc = zone.trim() ? canonicalZone(zone) : "UTC";
  return {
    kind: k,
    expr: formatSpread(spec),
    nextRun: planSpreadNext(spec, loc, now),
    timezone: loc,
  };
}

export function onceParsed(kind: string, at: number, tz: string): Parsed {
  return { kind, expr: formatRfc3339Nano(at), nextRun: at, timezone: tz };
}

export function examplesParsed(when: string, startHour: number, endHour: number, zone: string, now: number): Parsed {
  return parseSpreadSchedule(KindExamples, when, startHour, endHour, zone, now);
}

function strictInt(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

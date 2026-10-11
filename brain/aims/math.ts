import { type AimEffect, type AimMeasure, type AimWeek } from "@/lib/chat/aims";
import { SCORE_MAX, SCORE_MIN, type AimStats, type DayScore, type Series } from "./types";

const CORR_MIN_N = 8;
const CORR_MIN_R = 0.3;

export function clampScore(n: number): number {
  if (n < SCORE_MIN) {
    return SCORE_MIN;
  }
  if (n > SCORE_MAX) {
    return SCORE_MAX;
  }
  return n;
}

/** Ordinary least squares of y on x. A zero denominator is slope 0. */
export function ols(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n === 0 || ys.length !== n) {
    return 0;
  }
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) {
      return 0;
    }
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) {
    return 0;
  }
  return (n * sumXY - sumX * sumY) / den;
}

/**
 * Correlation of two equal-length series. `ok` is false under 8 points,
 * unequal lengths, or a side with zero variance.
 */
export function pearson(xs: readonly number[], ys: readonly number[]): { r: number; ok: boolean } {
  const n = xs.length;
  if (n < CORR_MIN_N || ys.length !== n) {
    return { r: 0, ok: false };
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) {
      return { r: 0, ok: false };
    }
    sumX += x;
    sumY += y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) {
      return { r: 0, ok: false };
    }
    const dx = x - meanX;
    const dy = y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) {
    return { r: 0, ok: false };
  }
  return { r: sxy / Math.sqrt(sxx * syy), ok: true };
}

/** A correlation is strong enough to stamp. A miss is the "too early" case; those words are not stamped. */
export function stampCorr(ok: boolean, r: number): boolean {
  return ok && Math.abs(r) >= CORR_MIN_R;
}

/** Slope of week means against week index. `ok` is false under two weeks. */
export function weekSlope(weeks: readonly { mean: number }[]): { slope: number; ok: boolean } {
  if (weeks.length < 2) {
    return { slope: 0, ok: false };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    if (!week) {
      return { slope: 0, ok: false };
    }
    xs.push(i);
    ys.push(week.mean);
  }
  return { slope: ols(xs, ys), ok: true };
}

function betterMeasure(m: AimMeasure, best: AimMeasure | null): boolean {
  if (!best || m.n > best.n) {
    return true;
  }
  if (m.n < best.n) {
    return false;
  }
  if (m.metric !== best.metric) {
    return m.metric < best.metric;
  }
  return m.unit < best.unit;
}

function latestMeasure(weeks: readonly AimWeek[]): { metric: string; unit: string } | null {
  for (let i = weeks.length - 1; i >= 0; i--) {
    const week = weeks[i];
    if (!week) {
      continue;
    }
    let best: AimMeasure | null = null;
    for (const measure of week.metrics) {
      if (measure.n === 0 || !measure.metric) {
        continue;
      }
      if (betterMeasure(measure, best)) {
        best = measure;
      }
    }
    if (best) {
      return { metric: best.metric, unit: best.unit };
    }
  }
  return null;
}

/**
 * Weekly mean score against the weekly mean of the aim's latest metric.
 * `ok` is Pearson's gate, not the stamp floor.
 */
export function effect(area: string, weeks: readonly AimWeek[]): { corr: AimEffect; ok: boolean } {
  const latest = latestMeasure(weeks);
  if (!latest) {
    return { corr: { a: area, b: "", metric: "", r: 0, n: 0 }, ok: false };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const week of weeks) {
    const measure = week.metrics.find((item) => item.metric === latest.metric && item.unit === latest.unit);
    if (!measure) {
      continue;
    }
    xs.push(week.mean);
    ys.push(measure.mean);
  }
  const got = pearson(xs, ys);
  return {
    corr: { a: area, b: "", metric: latest.metric, r: got.r, n: xs.length },
    ok: got.ok,
  };
}

export function statsFrom(days: readonly DayScore[]): AimStats {
  const st: AimStats = {
    sum7: 0,
    sum14: 0,
    up7: 0,
    against7: 0,
    streak: 0,
    rating30: 0,
    mean7: 0,
    lastNote: "",
    lastNoteAt: 0,
    hasEvents: false,
  };
  if (days.length === 0) {
    return st;
  }
  let sum30 = 0;
  for (const day of days) {
    sum30 += day.score;
    if (day.events.length > 0) {
      st.hasEvents = true;
    }
    for (const ev of day.events) {
      const note = ev.scores[0]?.note ?? "";
      if (!note) {
        continue;
      }
      let at = ev.createdAt;
      if (!at) {
        const parsed = Date.parse(`${ev.day}T00:00:00Z`);
        at = Number.isFinite(parsed) ? parsed : 0;
      }
      if (!st.lastNote || at > st.lastNoteAt) {
        st.lastNote = note;
        st.lastNoteAt = at;
      }
    }
  }
  st.rating30 = sum30 / days.length;
  const tail = (n: number) => (days.length <= n ? days : days.slice(days.length - n));
  const week = tail(7);
  let sum7 = 0;
  for (const day of week) {
    sum7 += day.score;
    if (day.score > 0) {
      st.up7 += 1;
    } else if (day.score < 0) {
      st.against7 += 1;
    }
  }
  st.sum7 = sum7;
  st.mean7 = week.length > 0 ? sum7 / week.length : 0;
  for (const day of tail(14)) {
    st.sum14 += day.score;
  }
  let end = days.length - 1;
  const last = days[end];
  if (end >= 0 && last && last.events.length === 0) {
    end -= 1;
  }
  for (let i = end; i >= 0; i--) {
    const day = days[i];
    if (!day || day.score <= 0) {
      break;
    }
    st.streak += 1;
  }
  return st;
}

/** Mean of each metric+unit over the days. Two units of one metric stay two rows. */
export function metricsFrom(days: readonly DayScore[]): AimMeasure[] {
  const got = new Map<string, { metric: string; unit: string; sum: number; n: number }>();
  for (const day of days) {
    for (const ev of day.events) {
      const metric = ev.metric.trim();
      if (ev.value == null || !metric) {
        continue;
      }
      const key = `${metric}\u001f${ev.unit}`;
      const acc = got.get(key) ?? { metric, unit: ev.unit, sum: 0, n: 0 };
      acc.sum += ev.value;
      acc.n += 1;
      got.set(key, acc);
    }
  }
  const out: AimMeasure[] = [];
  for (const acc of got.values()) {
    out.push({ metric: acc.metric, mean: acc.sum / acc.n, unit: acc.unit, n: acc.n });
  }
  out.sort((a, b) => (a.metric === b.metric ? (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0) : a.metric < b.metric ? -1 : 1));
  return out;
}

function slopePerDay(pts: readonly { day: string; v: number }[]): number {
  const first = pts[0];
  if (!first) {
    return 0;
  }
  const t0 = Date.parse(`${first.day}T00:00:00Z`);
  if (!Number.isFinite(t0)) {
    return 0;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of pts) {
    const t = Date.parse(`${point.day}T00:00:00Z`);
    if (!Number.isFinite(t)) {
      continue;
    }
    xs.push((t - t0) / 86_400_000);
    ys.push(point.v);
  }
  return ols(xs, ys);
}

/** Live measurements already filtered to one metric, in day order. */
export function summarizeSeries(metric: string, pts: readonly { day: string; value: number; unit: string }[]): Series {
  const ser: Series = { metric, unit: "", latest: 0, mean: 0, slope: 0, n: 0, ok: false };
  if (pts.length === 0) {
    return ser;
  }
  ser.ok = true;
  ser.n = pts.length;
  ser.unit = pts[0]?.unit ?? "";
  ser.latest = pts[pts.length - 1]?.value ?? 0;
  let sum = 0;
  for (const point of pts) {
    sum += point.value;
  }
  ser.mean = sum / pts.length;
  if (pts.length >= 2) {
    ser.slope = slopePerDay(pts.map((point) => ({ day: point.day, v: point.value })));
  }
  return ser;
}

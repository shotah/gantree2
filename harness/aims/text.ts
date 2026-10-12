import { type AimEffect, type AimLink, type AimWeek } from "@/lib/chat/aims";
import { stampCorr, weekSlope } from "./math";
import { type AimEvent, type AimStats, type DayScore, type Series } from "./types";

const WEEK_STAMP = 8;

/** Prompt-side age: just now, 5m ago, 3h ago, 12d ago. Negative reads as just now. */
function age(ms: number): string {
  const span = ms < 0 ? 0 : ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (span < minute) {
    return "just now";
  }
  if (span < hour) {
    return `${String(Math.floor(span / minute))}m ago`;
  }
  if (span < day) {
    return `${String(Math.floor(span / hour))}h ago`;
  }
  return `${String(Math.floor(span / day))}d ago`;
}

function formatPlus(n: number, digits: number): string {
  const fixed = n.toFixed(digits);
  if (fixed.startsWith("-")) {
    return fixed;
  }
  return `+${fixed}`;
}

function formatMean(v: number): string {
  const s = formatPlus(v, 1);
  if (s === "+0.0" || s === "-0.0") {
    return "0.0";
  }
  return s;
}

function formatSignedInt(n: number): string {
  if (n > 0) {
    return `+${String(n)}`;
  }
  return String(n);
}

/** fmt `%g` with the default 6 significant digits. */
function formatG(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

/** The `[aims]` tail. Empty when the aim has no ledger rows. */
export function suffix(st: AimStats, nowMs = 0): string {
  if (!st.hasEvents) {
    return "";
  }
  const parts = [
    `30d ${formatMean(st.rating30)}`,
    `7d ${formatSignedInt(st.sum7)}`,
    `streak ${st.streak}`,
  ];
  if (st.lastNote && st.lastNoteAt) {
    parts.push(`${st.lastNote} ${age(nowMs - st.lastNoteAt)}`);
  }
  return parts.join(" · ");
}

/**
 * Planner block for one aim: rating line, an optional measurement, then a
 * date grid. An empty day is "·".
 */
export function progress(
  area: string,
  days: readonly DayScore[],
  st: AimStats,
  ser: Series | null,
  nowMs: number,
): string {
  const head = suffix(st, nowMs) || "no ledger yet";
  let out = `${area} — ${head}`;
  if (ser?.ok) {
    out += `\n  ${ser.metric} latest ${formatG(ser.latest)} ${ser.unit.trim()}`;
    if (ser.n >= 2) {
      out += ` · slope ${formatPlus(ser.slope, 2)}/d`;
    }
  }
  for (const day of days) {
    if (day.events.length === 0) {
      out += `\n  ${day.day} ·`;
      continue;
    }
    out += `\n  ${day.day} ${formatSignedInt(day.score)}`;
    for (const ev of day.events) {
      out += ` #${String(ev.id)} ${ev.what}`;
    }
  }
  return out;
}

/** One history row: `#id day what — area ±n · area ±n`. */
export function formatLine(ev: AimEvent): string {
  let line = `#${String(ev.id)} ${ev.day} ${ev.what}`;
  if (ev.metric && ev.value != null) {
    line += ` (${ev.metric} ${formatG(ev.value)} ${ev.unit.trim()})`;
  }
  if (ev.scores.length > 0) {
    const parts = ev.scores.map((sc) => {
      const note = sc.note ? ` ${sc.note}` : "";
      return `${sc.area} ${formatSignedInt(sc.value)}${note}`;
    });
    line += ` — ${parts.join(" · ")}`;
  }
  return line;
}

/** Last eight week means, oldest of those first. */
export function formatWeeks(weeks: readonly AimWeek[]): string {
  const shown = weeks.length > WEEK_STAMP ? weeks.slice(weeks.length - WEEK_STAMP) : weeks;
  return `weeks: ${shown.map((week) => formatMean(week.mean)).join(" ")}`;
}

export function formatWeekSlope(weeks: readonly { mean: number }[]): string {
  const trend = weekSlope(weeks);
  if (!trend.ok) {
    return "";
  }
  return `slope ${formatPlus(trend.slope, 2)}/wk`;
}

export function formatEffect(corr: AimEffect, ok: boolean): string {
  if (!stampCorr(ok, corr.r)) {
    return "";
  }
  return `effect r=${formatPlus(corr.r, 2)} (${String(corr.n)})`;
}

export function formatCross(link: AimLink, ok: boolean): string {
  if (!stampCorr(ok, link.r)) {
    return "";
  }
  return `${link.a} → next-day ${link.b} r=${formatPlus(link.r, 2)} (${String(link.n)})`;
}

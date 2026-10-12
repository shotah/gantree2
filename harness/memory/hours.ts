import { localParts } from "@/harness/core/clock";

/**
 * A parse of `pref/hours`. Unparseable fields stay unset (`-1`).
 *
 * ```
 * sleep: 23:00-07:00
 * work: 09:00-17:00
 * quiet: (none)
 * ```
 */
export type Hours = {
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  quiet: string;
  raw: string;
  known(): boolean;
  /** Unknown hours are awake. Work is not do-not-disturb. End minute is exclusive. */
  asleepAt(nowMs: number, zone?: string): boolean;
  footer(): string;
};

const UNKNOWN_FOOTER = "[hours] unknown — ask sleep / work / extra quiet once; store preference subject pref/hours. Work is not DND.";

/** Fail-open: garbage lines are ignored. */
export function parseHours(content: string): Hours {
  const hours: Hours = {
    sleepStart: -1,
    sleepEnd: -1,
    workStart: -1,
    workEnd: -1,
    quiet: "",
    raw: content.trim(),
    known() {
      return this.sleepStart >= 0 && this.sleepEnd >= 0;
    },
    asleepAt(nowMs: number, zone = "UTC") {
      if (!this.known()) {
        return false;
      }
      const p = localParts(nowMs, zone);
      return inWindow(p.hour * 60 + p.minute, this.sleepStart, this.sleepEnd);
    },
    footer() {
      return hoursFooter(this);
    },
  };
  if (hours.raw === "") {
    return hours;
  }
  for (const line of hours.raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const lower = trimmed.toLowerCase();
    const cut = lower.indexOf(":");
    if (cut < 0) {
      continue;
    }
    const key = lower.slice(0, cut).trim();
    const val = lower.slice(cut + 1).trim();
    if (key === "sleep") {
      const w = parseWindow(val);
      hours.sleepStart = w[0];
      hours.sleepEnd = w[1];
    } else if (key === "work") {
      const w = parseWindow(val);
      hours.workStart = w[0];
      hours.workEnd = w[1];
    } else if (key === "quiet") {
      if (val !== "" && val !== "(none)" && val !== "none" && val !== "-") {
        hours.quiet = val;
      }
    }
  }
  return hours;
}

function hoursFooter(h: Hours): string {
  if (h.raw.trim() === "") {
    return UNKNOWN_FOOTER;
  }
  let sleep = "unknown";
  if (h.known()) {
    sleep = `${fmtHM(h.sleepStart)}-${fmtHM(h.sleepEnd)}`;
  }
  let work = "unknown";
  if (h.workStart >= 0 && h.workEnd >= 0) {
    work = `${fmtHM(h.workStart)}-${fmtHM(h.workEnd)}`;
  }
  const quiet = h.quiet !== "" ? h.quiet : "none";
  return `[hours] sleep ${sleep} · work ${work} · quiet ${quiet} — work is not DND; check-ins skip sleep`;
}

function parseWindow(s: string): [number, number] {
  const norm = s.trim().replaceAll("\u2013", "-").replaceAll("\u2014", "-");
  const cut = norm.indexOf("-");
  if (cut < 0) {
    return [-1, -1];
  }
  const start = parseHM(norm.slice(0, cut));
  const end = parseHM(norm.slice(cut + 1));
  if (start === null || end === null) {
    return [-1, -1];
  }
  return [start, end];
}

function parseHM(s: string): number | null {
  const t = s.trim();
  const cut = t.indexOf(":");
  if (cut < 0) {
    return null;
  }
  const hh = t.slice(0, cut);
  const mm = t.slice(cut + 1);
  if (!/^\d+$/.test(hh) || !/^\d+$/.test(mm)) {
    return null;
  }
  const h = Number(hh);
  const m = Number(mm);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

function inWindow(t: number, start: number, end: number): boolean {
  if (start === end) {
    return false;
  }
  if (start < end) {
    return t >= start && t < end;
  }
  return t >= start || t < end;
}

function fmtHM(mins: number): string {
  if (mins < 0) {
    return "unknown";
  }
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

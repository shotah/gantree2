import { localParts } from "@/harness/core/clock";

/** True when `now` falls in the sleep window of a `pref/hours` body. Unknown hours are awake. */
export function asleepAt(content: string, now: number, zone: string): boolean {
  const window = sleepWindow(content);
  if (!window) return false;
  const p = localParts(now, zone);
  const hour = p.hour === 24 ? 0 : p.hour;
  const t = hour * 60 + p.minute;
  return inWindow(t, window.start, window.end);
}

function sleepWindow(content: string): { start: number; end: number } | null {
  const raw = content.trim();
  if (!raw) return null;
  for (const lineRaw of raw.split("\n")) {
    const line = lineRaw.trim();
    const cut = line.indexOf(":");
    if (cut < 0) continue;
    const key = line.slice(0, cut).trim().toLowerCase();
    if (key !== "sleep") continue;
    return parseWindow(line.slice(cut + 1));
  }
  return null;
}

function parseWindow(s: string): { start: number; end: number } | null {
  const norm = s.trim().replaceAll("–", "-").replaceAll("—", "-");
  const cut = norm.indexOf("-");
  if (cut < 0) return null;
  const start = parseHm(norm.slice(0, cut));
  const end = parseHm(norm.slice(cut + 1));
  if (start == null || end == null) return null;
  return { start, end };
}

function parseHm(s: string): number | null {
  const t = s.trim();
  const cut = t.indexOf(":");
  if (cut < 0) return null;
  const h = Number(t.slice(0, cut));
  const m = Number(t.slice(cut + 1));
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function inWindow(t: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

import type { Role } from "./frame";

/**
 * The aims board: the crane's goals ledger as one pushed snapshot
 * (crane `docs/aims-progress.md` §4.4.1; contract in docs/frontends.md →
 * Aims board). Not a query — the crane sends `{ kind: "aims", aims: [...] }`
 * on dial after `cmds` and again whenever the board changed. The mailbox
 * keeps the latest and replays it on phone connect, the way `cmds` works.
 * An empty `aims` is a real frame: the screen clears.
 *
 * Field names below are the wire. The crane's `board.go` json tags must
 * match them; everything a mouth does not know is dropped.
 */

export const AIMS_STORE_KEY = "aims";
/** Same cap as the `[aims]` stamp. Extra rows are dropped, first five kept. */
export const AIMS_MAX = 5;
/** `[progress]` is a five-day grid; allow the week if the crane grows it. */
export const AIM_DAYS_MAX = 14;
/** Crane `Weeks` keeps 13 Sunday-start buckets; the stamp shows 8, the screen all 13. */
export const AIM_WEEKS_MAX = 13;
/** Cross-aim next-day lines, strongest first — the crane's `crossLines` cap. */
export const AIM_LINKS_MAX = 3;
export const AIM_AREA_MAX = 32;
export const AIM_SENTENCE_MAX = 240;
export const AIM_NOTE_MAX = 32;

/** One calendar day on an aim: the clamped day score and the ledger ids behind it. */
export type AimDay = { day: string; score: number; events: number[] };

/** One metric's mean over a week, unit as logged (`lb` and `kg` are two entries). */
export type AimMeasure = { metric: string; mean: number; unit: string; n: number };

/** One Sunday-start local week inside the aim's life. `mean` includes zero days. */
export type AimWeek = { start: string; mean: number; up: number; against: number; metrics: AimMeasure[] };

/** Block adherence over `[from, to]`, present only when the crane has a block row. */
export type AimBlock = { days: number; up: number; against: number; mean: number; pct: number };

/** A Pearson line the crane chose to stamp (`|r| ≥ 0.3`, `n ≥ 8`). Absent means nothing is known. */
export type AimEffect = { a: string; b: string; metric: string; r: number; n: number };

/** Cross-aim: day score of `a` against next-day score of `b`. Board-level, not per aim. */
export type AimLink = { a: string; b: string; r: number; n: number };

export type AimRow = {
  /** The `aim/<area>` key. */
  area: string;
  /** The months-scale sentence from memory. */
  sentence: string;
  /** 30-day mean day score, `-3.0 … +3.0`. */
  rating30: number;
  /** Sum of the last seven day scores. */
  sum7: number;
  /** Consecutive days scored `> 0`. */
  streak: number;
  /** Last agent note on this aim: nudged | asked | offered | praised | quiet | "". */
  note: string;
  /** Local `YYYY-MM-DD` of that note, when the crane sends it. */
  note_at?: string;
  /** Oldest first. An empty day is `score 0, events []`. */
  days: AimDay[];
  /** Oldest first, from the aim's first event, cap 13. Absent before the first week closes. */
  weeks?: AimWeek[];
  /** Score per week over the week means (`WeekSlope`), when there are two or more weeks. */
  slope?: number;
  block?: AimBlock;
  effect?: AimEffect;
};

/** The whole frame body: rows plus the cross-aim lines that sit under all of them. */
export type AimsBoard = { aims: AimRow[]; links: AimLink[] };

export function phoneMustNotPublishAims(role: Role, kind?: string): boolean {
  return role === "phone" && kind === "aims";
}

export function agentPublishedAims(role: Role, kind?: string): boolean {
  return role === "crane" && kind === "aims";
}

/** Room board when the crane names no human; that human's board when it does. */
export function aimsStoreKey(userId?: string): string {
  const owner = userId?.trim();
  return owner ? `${AIMS_STORE_KEY}:${owner}` : AIMS_STORE_KEY;
}

const AREA_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.length <= max ? v.trim() : undefined;
}

function parseDays(raw: unknown): AimDay[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AimDay[] = [];
  for (const item of raw) {
    if (out.length >= AIM_DAYS_MAX) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const day = typeof o.day === "string" && DAY_RE.test(o.day) ? o.day : undefined;
    const score = int(o.score);
    if (!day || score === undefined) {
      continue;
    }
    const events = Array.isArray(o.events)
      ? o.events.filter((e): e is number => int(e) !== undefined).slice(0, 32)
      : [];
    out.push({ day, score: Math.max(-3, Math.min(3, score)), events });
  }
  return out;
}

function parseMeasures(raw: unknown): AimMeasure[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AimMeasure[] = [];
  for (const item of raw) {
    if (out.length >= 8 || !item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const metric = str(o.metric, AIM_AREA_MAX);
    const mean = num(o.mean);
    const n = int(o.n);
    if (!metric || mean === undefined || n === undefined) {
      continue;
    }
    out.push({ metric, mean, unit: str(o.unit, 16) ?? "", n });
  }
  return out;
}

export function parseWeeks(raw: unknown): AimWeek[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AimWeek[] = [];
  for (const item of raw) {
    if (out.length >= AIM_WEEKS_MAX) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const start = typeof o.start === "string" && DAY_RE.test(o.start) ? o.start : undefined;
    const mean = num(o.mean);
    if (!start || mean === undefined) {
      continue;
    }
    out.push({
      start,
      mean: Math.max(-3, Math.min(3, mean)),
      up: Math.max(0, int(o.up) ?? 0),
      against: Math.max(0, int(o.against) ?? 0),
      metrics: parseMeasures(o.metrics),
    });
  }
  return out;
}

/** Cross-aim lines. Both areas named, `r` finite, `n` an integer; strongest first as sent. */
export function parseLinks(raw: unknown): AimLink[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AimLink[] = [];
  for (const item of raw) {
    if (out.length >= AIM_LINKS_MAX) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const a = typeof o.a === "string" ? o.a.trim().toLowerCase() : "";
    const b = typeof o.b === "string" ? o.b.trim().toLowerCase() : "";
    const r = num(o.r);
    const n = int(o.n);
    if (!AREA_RE.test(a) || !AREA_RE.test(b) || a === b || r === undefined || n === undefined) {
      continue;
    }
    out.push({ a, b, r: Math.max(-1, Math.min(1, r)), n });
  }
  return out;
}

function parseBlock(raw: unknown): AimBlock | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const days = int(o.days);
  const up = int(o.up);
  const against = int(o.against);
  const mean = num(o.mean);
  const pct = num(o.pct);
  if (days === undefined || up === undefined || against === undefined || mean === undefined || pct === undefined) {
    return undefined;
  }
  return { days, up, against, mean, pct };
}

function parseEffect(raw: unknown): AimEffect | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const r = num(o.r);
  const n = int(o.n);
  if (r === undefined || n === undefined) {
    return undefined;
  }
  return {
    a: str(o.a, AIM_AREA_MAX) ?? "",
    b: str(o.b, AIM_AREA_MAX) ?? "",
    metric: str(o.metric, AIM_AREA_MAX) ?? "",
    r,
    n,
  };
}

/** Untrusted wire → board rows. A bad row is dropped, not fatal; junk is an empty board. */
export function parseAimsBoard(raw: unknown): AimRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AimRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= AIMS_MAX) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const area = typeof o.area === "string" ? o.area.trim().toLowerCase() : "";
    if (!AREA_RE.test(area) || seen.has(area)) {
      continue;
    }
    const sentence = str(o.sentence, AIM_SENTENCE_MAX);
    if (!sentence) {
      continue;
    }
    const row: AimRow = {
      area,
      sentence,
      rating30: Math.max(-3, Math.min(3, num(o.rating30) ?? 0)),
      sum7: int(o.sum7) ?? 0,
      streak: Math.max(0, int(o.streak) ?? 0),
      note: str(o.note, AIM_NOTE_MAX) ?? "",
      days: parseDays(o.days),
    };
    if (typeof o.note_at === "string" && DAY_RE.test(o.note_at)) {
      row.note_at = o.note_at;
    }
    const weeks = parseWeeks(o.weeks);
    if (weeks.length) {
      row.weeks = weeks;
    }
    const slope = num(o.slope);
    if (slope !== undefined) {
      row.slope = slope;
    }
    const block = parseBlock(o.block);
    if (block) {
      row.block = block;
    }
    const effect = parseEffect(o.effect);
    if (effect) {
      row.effect = effect;
    }
    seen.add(area);
    out.push(row);
  }
  return out;
}

/** The frame body from the wire: rows and links, each tolerant on its own. */
export function parseAimsFrame(o: Record<string, unknown>): AimsBoard {
  return { aims: parseAimsBoard(o.aims), links: parseLinks(o.links) };
}

/** `training → next-day weight r +0.42 (n 12)` — the same words as the `/aims` footer. */
export function linkLine(l: AimLink): string {
  return `${l.a} → next-day ${l.b} r ${signed(l.r, 2)} (n ${l.n})`;
}

/** `+1.4`, `-0.3`, `0` — the sign is the point. */
export function signed(n: number, digits = 0): string {
  const fixed = n.toFixed(digits);
  if (Number(fixed) === 0) {
    return digits ? `0.${"0".repeat(digits)}` : "0";
  }
  return n > 0 ? `+${fixed}` : fixed;
}

/** What the day cell says out loud. */
export function dayLabel(d: AimDay): string {
  const when = new Date(`${d.day}T00:00:00`);
  const weekday = Number.isNaN(when.getTime())
    ? d.day
    : when.toLocaleDateString(undefined, { weekday: "short" });
  return d.events.length ? `${weekday} ${signed(d.score)}` : `${weekday} no event`;
}

/** The stamp line the crane puts under `[aims]`, for the screen to match: `30d +1.4 · 7d +6 · streak 2 · asked`. */
export function statsLine(row: AimRow): string {
  const parts = [`30d ${signed(row.rating30, 1)}`, `7d ${signed(row.sum7)}`];
  if (row.streak > 0) {
    parts.push(`streak ${row.streak}`);
  }
  if (row.note) {
    parts.push(row.note);
  }
  return parts.join(" · ");
}

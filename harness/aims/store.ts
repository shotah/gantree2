import { type Clock } from "@/harness/core/clock";
import { type Logger } from "@/harness/core/log";
import { migrate, type Sql, type SqlValue } from "@/harness/core/sql";
import { type WireFrame } from "@/harness/core/wire";
import {
  AIM_LINKS_MAX,
  AIM_SENTENCE_MAX,
  AIM_WEEKS_MAX,
  AIMS_MAX,
  type AimBlock,
  type AimLink,
  type AimRow,
  type AimWeek,
  type AimsBoard,
} from "@/lib/chat/aims";
import { addDays, isSunday, localDay, parseDay, weekStart } from "./calendar";
import { AimsError } from "./error";
import { clampScore, effect, metricsFrom, pearson, stampCorr, statsFrom, summarizeSeries, weekSlope } from "./math";
import { type AimMemory } from "./memory";
import { AIM_MIGRATIONS } from "./schema";
import { formatCross, formatEffect, formatWeekSlope, formatWeeks, progress } from "./text";
import {
  SCORE_MAX,
  SCORE_MIN,
  SOURCE_DEFAULT,
  type AimEvent,
  type AimScore,
  type AimStats,
  type BlockSpan,
  type DayScore,
  type LogInput,
  type Series,
} from "./types";

const AIM_PREFIX = "aim/";
const BOOTSTRAP = "bootstrap";
const AREA_WIRE = /^[a-z0-9][a-z0-9_-]*$/;
const DEFAULT_HISTORY = 50;
const RATING_DAYS = 30;
const PROGRESS_DAYS = 5;
const NEXT_DAY_DAYS = 90;

const EVENT_SELECT = "e.id, e.day, e.what, e.ref, e.metric, e.value, e.unit, e.source, e.created_at, e.superseded_by";

type EventRow = {
  id: number;
  day: string | null;
  what: string | null;
  ref: string | null;
  metric: string | null;
  value: number | null;
  unit: string | null;
  source: string | null;
  created_at: string | null;
  superseded_by: number | null;
};

type DayRow = EventRow & {
  score: number | null;
  note: string | null;
};

type ScoreRow = {
  event_id: number;
  area: string | null;
  score: number | null;
  note: string | null;
};

type PointRow = {
  day: string | null;
  value: number | null;
  unit: string | null;
};

function text(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "bigint") {
    return String(v);
  }
  return "";
}

function num(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "bigint") {
    return Number(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readEvent(row: EventRow): AimEvent {
  const id = num(row.id);
  if (id == null || id <= 0) {
    throw new AimsError("aims: bad event id");
  }
  const created = typeof row.created_at === "string" ? Date.parse(row.created_at) : Number.NaN;
  return {
    id,
    day: text(row.day),
    what: text(row.what),
    ref: text(row.ref),
    metric: text(row.metric),
    value: row.value == null ? null : num(row.value),
    unit: text(row.unit),
    source: text(row.source),
    createdAt: Number.isFinite(created) ? created : 0,
    supersededBy: row.superseded_by == null ? null : num(row.superseded_by),
    scores: [],
  };
}

function clipRunes(value: string, max: number): string {
  const runes = [...value];
  if (runes.length <= max) {
    return value;
  }
  return runes.slice(0, max).join("");
}

function capAreas(areas: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of areas) {
    const area = raw.trim();
    if (!area || area === BOOTSTRAP) {
      continue;
    }
    out.push(area);
    if (out.length === AIMS_MAX) {
      break;
    }
  }
  return out;
}

function normalizeScores(scores: Record<string, number>, live: readonly string[]): Record<string, number> {
  const keys = Object.keys(scores);
  if (keys.length === 0) {
    throw new AimsError("aims: scores required");
  }
  const liveSet = new Set(live);
  const norm: Record<string, number> = {};
  for (const raw of keys) {
    const area = raw.trim();
    const n = scores[raw];
    if (!area) {
      throw new AimsError("aims: empty area");
    }
    if (n === undefined || !Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
      throw new AimsError(`aims: score for ${area} must be ${String(SCORE_MIN)}..${String(SCORE_MAX)}, got ${String(n)}`);
    }
    if (!liveSet.has(area)) {
      const listed = live.length > 0 ? live.join(", ") : "none";
      throw new AimsError(`aims: unknown area ${JSON.stringify(area)} (live: ${listed})`);
    }
    norm[area] = n;
  }
  return norm;
}

function overlay(old: AimEvent | null, input: LogInput, today: string): {
  day: string;
  what: string;
  ref: string;
  metric: string;
  value: number | null;
  unit: string;
  source: string;
} {
  const out = {
    day: old?.day ?? "",
    what: old?.what ?? "",
    ref: old?.ref ?? "",
    metric: old?.metric ?? "",
    value: old?.value ?? null,
    unit: old?.unit ?? "",
    source: old?.source ?? "",
  };
  const what = input.what?.trim() ?? "";
  if (what) {
    out.what = what;
  }
  const day = input.day?.trim() ?? "";
  if (day) {
    out.day = day;
  }
  if (!out.day) {
    out.day = today;
  }
  const ref = input.ref?.trim() ?? "";
  if (ref) {
    out.ref = ref;
  }
  const metric = input.metric?.trim() ?? "";
  if (metric) {
    out.metric = metric;
    out.value = input.value ?? null;
    out.unit = (input.unit ?? "").trim();
  } else if (input.value != null) {
    out.value = input.value;
    const unit = (input.unit ?? "").trim();
    if (unit) {
      out.unit = unit;
    }
  }
  const source = input.source?.trim() ?? "";
  if (source) {
    out.source = source;
  }
  if (!out.source) {
    out.source = SOURCE_DEFAULT;
  }
  out.what = out.what.trim();
  out.ref = out.ref.trim();
  out.metric = out.metric.trim();
  out.unit = out.unit.trim();
  return out;
}

function emptyBlock(): AimBlock {
  return { days: 0, up: 0, against: 0, mean: 0, pct: 0 };
}

function latestMetric(days: readonly DayScore[]): string {
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (!day) {
      continue;
    }
    for (let j = day.events.length - 1; j >= 0; j--) {
      const metric = day.events[j]?.metric.trim() ?? "";
      if (metric) {
        return metric;
      }
    }
  }
  return "";
}

/**
 * Ledger of events scored against live `aim/<area>` rows.
 * Time comes from `clock` (the human's zone). The Durable Object invocation
 * is the transaction; statements are ordered so a rewrite frees the live
 * `ref` index before the new row is inserted.
 */
export class AimStore {
  private readonly logger: Logger;

  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    log: Logger,
    private readonly memory: AimMemory | null,
  ) {
    this.logger = log.with({ pkg: "aims" });
    const applied = migrate(this.sql, AIM_MIGRATIONS);
    this.sql.exec("PRAGMA foreign_keys = ON");
    this.logger.debug("ready", { applied });
  }

  /** Local calendar day of `nowMs`, or of the clock when omitted. */
  today(nowMs?: number): string {
    return localDay(nowMs ?? this.clock.now(), this.clock.zone);
  }

  /** Live `aim/<area>` slugs. `aim/bootstrap` is omitted. */
  areas(): string[] {
    if (!this.memory) {
      return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of this.memory.listAims()) {
      const subject = entry.subject.trim();
      let area = subject.startsWith(AIM_PREFIX) ? subject.slice(AIM_PREFIX.length) : subject;
      area = area.trim();
      if (!area || area === BOOTSTRAP || seen.has(area)) {
        continue;
      }
      seen.add(area);
      out.push(area);
    }
    out.sort();
    return out;
  }

  /**
   * Insert an event scored against each area. A set `ref` supersedes the live
   * row with that ref; a set `id` supersedes that live event. Blank fields on
   * a rewrite copy from the old row. New scores overlay; other areas keep theirs.
   */
  log(input: LogInput, scores: Record<string, number>): AimEvent {
    const norm = normalizeScores(scores, this.areas());
    let old: AimEvent | null = null;
    if (input.id != null && input.id > 0) {
      old = this.eventById(input.id);
      if (!old) {
        throw new AimsError(`aims: event ${String(input.id)} not found`);
      }
      if (old.supersededBy != null) {
        throw new AimsError(`aims: event ${String(input.id)} is superseded`);
      }
    } else if (input.ref?.trim()) {
      old = this.liveByRef(input.ref.trim());
    }
    const merged = overlay(old, input, this.today());
    if (!merged.what) {
      throw new AimsError("aims: what is required");
    }
    parseDay(merged.day);

    const scoreMap = new Map<string, AimScore>();
    for (const sc of old?.scores ?? []) {
      scoreMap.set(sc.area, sc);
    }
    const note = input.note?.trim() ?? "";
    for (const area of Object.keys(norm).sort()) {
      const value = norm[area];
      if (value === undefined) {
        continue;
      }
      const kept = !note ? scoreMap.get(area)?.note ?? "" : note;
      scoreMap.set(area, { area, value, note: kept });
    }

    if (old) {
      this.sql.exec(
        "UPDATE aim_event SET superseded_by = id WHERE id = ? AND superseded_by IS NULL",
        old.id,
      );
      if (this.sql.changes() === 0) {
        throw new AimsError(`aims: event ${String(old.id)} is superseded`);
      }
    }

    const createdAt = new Date(this.clock.now()).toISOString();
    const inserted = this.sql.exec<{ id: number }>(
      `INSERT INTO aim_event (day, what, ref, metric, value, unit, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      merged.day,
      merged.what,
      merged.ref,
      merged.metric,
      merged.value,
      merged.unit,
      merged.source,
      createdAt,
    );
    const id = num(inserted[0]?.id);
    if (id == null) {
      throw new AimsError("aims: insert: no id");
    }
    if (old) {
      this.sql.exec("UPDATE aim_event SET superseded_by = ? WHERE id = ?", id, old.id);
    }
    for (const area of [...scoreMap.keys()].sort()) {
      const sc = scoreMap.get(area);
      if (!sc) {
        continue;
      }
      this.sql.exec(
        "INSERT INTO aim_score (event_id, area, score, note) VALUES (?, ?, ?, ?)",
        id,
        area,
        sc.value,
        sc.note,
      );
    }
    const saved = this.get(id);
    this.logger.debug("logged", { id, day: saved.day });
    return saved;
  }

  /** One event, live or superseded, with its scores. */
  get(id: number): AimEvent {
    const ev = this.eventById(id);
    if (!ev) {
      throw new AimsError(`aims: event ${String(id)} not found`);
    }
    return ev;
  }

  /**
   * Live events, newest first. Empty `area` lists every aim. `from` and `to`
   * are inclusive `YYYY-MM-DD`; blank is unbounded. `limit` below 1 is 50.
   * A filtered event still includes every area's scores.
   */
  history(area = "", from = "", to = "", limit = 0): AimEvent[] {
    const wanted = area.trim();
    const start = from.trim();
    const end = to.trim();
    if (start) {
      parseDay(start);
    }
    if (end) {
      parseDay(end);
    }
    const lim = limit < 1 ? DEFAULT_HISTORY : limit;
    const where = ["e.superseded_by IS NULL"];
    const params: SqlValue[] = [];
    if (wanted) {
      where.push("s.area = ?");
      params.push(wanted);
    }
    if (start) {
      where.push("e.day >= ?");
      params.push(start);
    }
    if (end) {
      where.push("e.day <= ?");
      params.push(end);
    }
    params.push(lim);
    const rows = this.sql.exec<EventRow>(
      `SELECT DISTINCT ${EVENT_SELECT}
       FROM aim_event e
       JOIN aim_score s ON s.event_id = e.id
       WHERE ${where.join(" AND ")}
       ORDER BY e.day DESC, e.id DESC
       LIMIT ?`,
      ...params,
    );
    const events = rows.map((row) => readEvent(row));
    const byId = this.scoresFor(events.map((ev) => ev.id));
    for (const ev of events) {
      ev.scores = byId.get(ev.id) ?? [];
    }
    return events;
  }

  /** Drop scores for `area`. An event with no scores left is superseded. */
  forget(area: string): void {
    const wanted = area.trim();
    if (!wanted) {
      throw new AimsError("aims: empty area");
    }
    this.sql.exec("DELETE FROM aim_score WHERE area = ?", wanted);
    this.sql.exec(
      `UPDATE aim_event SET superseded_by = id
       WHERE superseded_by IS NULL
         AND id NOT IN (SELECT event_id FROM aim_score)`,
    );
    this.logger.debug("forgot", { area: wanted });
  }

  /** The dated span for `area`, or null when none is stored. */
  block(area: string): BlockSpan | null {
    const wanted = area.trim();
    if (!wanted) {
      throw new AimsError("aims: empty area");
    }
    const row = this.sql.one<{ area: string; from_day: string; to_day: string }>(
      "SELECT area, from_day, to_day FROM aim_block WHERE area = ?",
      wanted,
    );
    if (!row) {
      return null;
    }
    return { area: row.area, fromDay: row.from_day, toDay: row.to_day };
  }

  /** Write the dated span for `area`. */
  setBlock(area: string, from: string, to: string): void {
    const wanted = area.trim();
    if (!wanted) {
      throw new AimsError("aims: empty area");
    }
    const start = parseDay(from);
    const end = parseDay(to);
    if (start > end) {
      throw new AimsError(`aims: block from ${start} is after to ${end}`);
    }
    this.sql.exec(
      `INSERT INTO aim_block (area, from_day, to_day) VALUES (?, ?, ?)
       ON CONFLICT(area) DO UPDATE SET from_day = excluded.from_day, to_day = excluded.to_day`,
      wanted,
      start,
      end,
    );
  }

  /**
   * One row per calendar day from `fromDay` through `toDay`, inclusive.
   * The score is the sum of live events that day, clamped to -3..+3.
   */
  dayScores(area: string, fromDay: string, toDay: string): DayScore[] {
    const wanted = area.trim();
    if (!wanted) {
      throw new AimsError("aims: empty area");
    }
    const start = parseDay(fromDay);
    const end = parseDay(toDay);
    if (start > end) {
      throw new AimsError(`aims: from ${start} is after to ${end}`);
    }
    const rows = this.sql.exec<DayRow>(
      `SELECT ${EVENT_SELECT}, s.score AS score, s.note AS note
       FROM aim_event e
       JOIN aim_score s ON s.event_id = e.id
       WHERE e.superseded_by IS NULL AND s.area = ? AND e.day >= ? AND e.day <= ?
       ORDER BY e.day, e.id`,
      wanted,
      start,
      end,
    );
    const byDay = new Map<string, { score: number; events: AimEvent[] }>();
    for (const row of rows) {
      const ev = readEvent(row);
      ev.scores = [{ area: wanted, value: num(row.score) ?? 0, note: text(row.note) }];
      const bucket = byDay.get(ev.day) ?? { score: 0, events: [] };
      bucket.score += num(row.score) ?? 0;
      bucket.events.push(ev);
      byDay.set(ev.day, bucket);
    }
    const out: DayScore[] = [];
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const hit = byDay.get(day);
      out.push({
        day,
        score: hit ? clampScore(hit.score) : 0,
        events: hit ? hit.events : [],
      });
    }
    return out;
  }

  /** Windows ending on `nowMs`'s local calendar day, or the clock when omitted. */
  statsAt(area: string, nowMs?: number): AimStats {
    const today = this.today(nowMs);
    const from = addDays(today, -(RATING_DAYS - 1));
    return statsFrom(this.dayScores(area, from, today));
  }

  /** Live measurements for `area`+`metric` between the days, inclusive. */
  seriesAt(area: string, metric: string, fromDay: string, toDay: string): Series {
    const wanted = area.trim();
    const name = metric.trim();
    if (!wanted || !name) {
      throw new AimsError("aims: area and metric are required");
    }
    const start = parseDay(fromDay);
    const end = parseDay(toDay);
    const rows = this.sql.exec<PointRow>(
      `SELECT e.day AS day, e.value AS value, e.unit AS unit
       FROM aim_event e
       JOIN aim_score s ON s.event_id = e.id
       WHERE e.superseded_by IS NULL AND s.area = ? AND e.metric = ?
         AND e.value IS NOT NULL AND e.day >= ? AND e.day <= ?
       ORDER BY e.day, e.id`,
      wanted,
      name,
      start,
      end,
    );
    const pts: { day: string; value: number; unit: string }[] = [];
    for (const row of rows) {
      if (row.value == null || !row.day) {
        continue;
      }
      const value = num(row.value);
      if (value == null) {
        continue;
      }
      pts.push({ day: row.day, value, unit: text(row.unit) });
    }
    return summarizeSeries(name, pts);
  }

  /**
   * Sunday-start weeks from the aim's first live event through the week that
   * contains `nowMs`, oldest first. More than 13 weeks drops the oldest.
   * No events is an empty list. The mean includes zero days inside the aim's
   * life; days before the first event, and days after today, are not in it.
   */
  weeks(area: string, nowMs?: number): AimWeek[] {
    const wanted = area.trim();
    if (!wanted) {
      throw new AimsError("aims: empty area");
    }
    const today = this.today(nowMs);
    const first = this.firstDay(wanted);
    if (!first) {
      return [];
    }
    const end = weekStart(today);
    const starts: string[] = [];
    for (let day = weekStart(first); day <= end; day = addDays(day, 7)) {
      starts.push(day);
    }
    const capped = starts.length > AIM_WEEKS_MAX ? starts.slice(starts.length - AIM_WEEKS_MAX) : starts;
    const out: AimWeek[] = [];
    for (const start of capped) {
      const weekEnd = addDays(start, 6);
      const from = start < first ? first : start;
      const to = weekEnd > today ? today : weekEnd;
      if (from > to) {
        continue;
      }
      const days = this.dayScores(wanted, from, to);
      let sum = 0;
      let up = 0;
      let against = 0;
      for (const day of days) {
        sum += day.score;
        if (day.score > 0) {
          up += 1;
        } else if (day.score < 0) {
          against += 1;
        }
      }
      out.push({
        start,
        mean: days.length > 0 ? sum / days.length : 0,
        up,
        against,
        metrics: metricsFrom(days),
      });
    }
    return out;
  }

  /**
   * Adherence over the stored span, clipped to today. `ok` is false when no
   * row is stored. A span that has not started is `days` 0.
   */
  blockStats(area: string, nowMs?: number): { stats: AimBlock; ok: boolean } {
    const span = this.block(area);
    if (!span) {
      return { stats: emptyBlock(), ok: false };
    }
    const today = this.today(nowMs);
    const to = span.toDay > today ? today : span.toDay;
    if (span.fromDay > to) {
      return { stats: emptyBlock(), ok: true };
    }
    const days = this.dayScores(area, span.fromDay, to);
    let sum = 0;
    let up = 0;
    let against = 0;
    for (const day of days) {
      sum += day.score;
      if (day.score > 0) {
        up += 1;
      } else if (day.score < 0) {
        against += 1;
      }
    }
    const count = days.length;
    return {
      ok: true,
      stats: {
        days: count,
        up,
        against,
        mean: count > 0 ? sum / count : 0,
        pct: count > 0 ? up / count : 0,
      },
    };
  }

  /**
   * Aim `a`'s score on days `a` was logged, against aim `b` the next day,
   * over the 90 local days ending today. A missing `b` day is 0. Days `a`
   * was not logged do not count. `ok` is Pearson's gate.
   */
  nextDay(a: string, b: string, nowMs?: number): { link: AimLink; ok: boolean } {
    const today = this.today(nowMs);
    const from = addDays(today, -(NEXT_DAY_DAYS - 1));
    const daysA = this.dayScores(a, from, today);
    const daysB = this.dayScores(b, from, today);
    const byB = new Map(daysB.map((day) => [day.day, day.score]));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const day of daysA) {
      if (day.events.length === 0) {
        continue;
      }
      const next = addDays(day.day, 1);
      if (next > today) {
        continue;
      }
      xs.push(day.score);
      ys.push(byB.get(next) ?? 0);
    }
    const got = pearson(xs, ys);
    return { link: { a, b, r: got.r, n: xs.length }, ok: got.ok };
  }

  /** `[progress]` block: five local days per area, and the Sunday trend lines. */
  progressText(areas: readonly string[], nowMs?: number): string {
    if (areas.length === 0) {
      return "";
    }
    const now = nowMs ?? this.clock.now();
    const today = localDay(now, this.clock.zone);
    const from = addDays(today, -(PROGRESS_DAYS - 1));
    const month = addDays(today, -(RATING_DAYS - 1));
    const sunday = isSunday(now, this.clock.zone);
    let out = "";
    for (const raw of areas) {
      const area = raw.trim();
      if (!area || area === BOOTSTRAP) {
        continue;
      }
      let days: DayScore[];
      let st: AimStats;
      try {
        days = this.dayScores(area, from, today);
        st = this.statsAt(area, now);
      } catch {
        continue;
      }
      let ser: Series | null = null;
      const metric = latestMetric(days);
      if (metric) {
        try {
          const got = this.seriesAt(area, metric, month, today);
          if (got.ok) {
            ser = got;
          }
        } catch {
          ser = null;
        }
      }
      if (!out) {
        out = "[progress]";
      }
      out += `\n${progress(area, days, st, ser, now)}`;
      const block = this.blockLine(area, now);
      if (block) {
        out += `\n  ${block}`;
      }
      if (sunday) {
        const extra = this.weekLines(area, now);
        if (extra) {
          out += `\n${extra}`;
        }
      }
    }
    if (sunday) {
      for (const hit of this.crossHits(areas, now)) {
        out += `\n${hit.line}`;
      }
    }
    return out;
  }

  /** `/aims <area>` header under the rating: block, week means, slope, effect. */
  areaTrend(area: string, nowMs?: number): string {
    const now = nowMs ?? this.clock.now();
    const lines: string[] = [];
    const block = this.blockLine(area, now);
    if (block) {
      lines.push(block);
    }
    const extra = this.weekLines(area, now);
    if (extra) {
      lines.push(extra);
    }
    return lines.join("\n");
  }

  /** `/aims` footer: one block line per area, then up to three cross-aim lines. */
  boardTrend(areas: readonly string[], nowMs?: number): string {
    const now = nowMs ?? this.clock.now();
    const lines: string[] = [];
    for (const raw of areas) {
      const area = raw.trim();
      if (!area || area === BOOTSTRAP) {
        continue;
      }
      const block = this.blockLine(area, now);
      if (block) {
        lines.push(`${area} ${block}`);
      }
    }
    for (const hit of this.crossHits(areas, now)) {
      lines.push(hit.line);
    }
    return lines.join("\n");
  }

  /**
   * Phone snapshot. Rows follow the first five areas. A row with no sentence,
   * or an area the phone's pattern rejects, is dropped. Links are the
   * cross-aim lines, strongest first, cap 3. An empty `aims` list is a real board.
   */
  board(areas: readonly string[], nowMs?: number): AimsBoard {
    const now = nowMs ?? this.clock.now();
    const capped = capAreas(areas);
    const aims: AimRow[] = [];
    for (const area of capped) {
      const row = this.boardRow(area, now);
      if (row) {
        aims.push(row);
      }
    }
    return {
      aims,
      links: this.crossHits(capped, now).map((hit) => hit.link),
    };
  }

  /** `{ kind: "aims" }` frame. Empty `aims` stays; `links` is omitted when none stamp. */
  wireFrame(areas: readonly string[], nowMs?: number): WireFrame {
    return aimsFrame(this.board(areas, nowMs));
  }

  private boardRow(area: string, nowMs: number): AimRow | null {
    if (!AREA_WIRE.test(area)) {
      return null;
    }
    const sentence = this.sentence(area);
    if (!sentence) {
      return null;
    }
    const today = localDay(nowMs, this.clock.zone);
    const from = addDays(today, -(PROGRESS_DAYS - 1));
    const days = this.dayScores(area, from, today);
    const st = this.statsAt(area, nowMs);
    const weeks = this.weeks(area, nowMs);
    const row: AimRow = {
      area,
      sentence,
      rating30: st.rating30,
      sum7: st.sum7,
      streak: st.streak,
      note: st.lastNote,
      days: days.map((day) => ({
        day: day.day,
        score: day.score,
        events: day.events.map((ev) => ev.id),
      })),
    };
    if (st.lastNoteAt !== 0) {
      row.note_at = localDay(st.lastNoteAt, this.clock.zone);
    }
    if (weeks.length > 0) {
      row.weeks = weeks;
    }
    const trend = weekSlope(weeks);
    if (trend.ok) {
      row.slope = trend.slope;
    }
    const block = this.blockStats(area, nowMs);
    if (block.ok && block.stats.days > 0) {
      row.block = block.stats;
    }
    const measured = effect(area, weeks);
    if (stampCorr(measured.ok, measured.corr.r)) {
      row.effect = measured.corr;
    }
    return row;
  }

  private sentence(area: string): string | null {
    if (!this.memory) {
      return null;
    }
    const raw = this.memory.sentence(area);
    if (raw == null) {
      return null;
    }
    const value = raw.trim();
    if (!value) {
      return null;
    }
    return clipRunes(value, AIM_SENTENCE_MAX);
  }

  private blockLine(area: string, nowMs: number): string {
    try {
      const { stats, ok } = this.blockStats(area, nowMs);
      if (!ok || stats.days === 0) {
        return "";
      }
      return `block ${String(stats.up)}/${String(stats.days)} (${String(Math.round(stats.pct * 100))}%)`;
    } catch {
      return "";
    }
  }

  private weekLines(area: string, nowMs: number): string {
    let weeks: AimWeek[];
    try {
      weeks = this.weeks(area, nowMs);
    } catch {
      return "";
    }
    if (weeks.length === 0) {
      return "";
    }
    const lines: string[] = [];
    const means = formatWeeks(weeks);
    if (means) {
      lines.push(`  ${means}`);
    }
    const slope = formatWeekSlope(weeks);
    if (slope) {
      lines.push(`  ${slope}`);
    }
    const measured = effect(area, weeks);
    const stamped = formatEffect(measured.corr, measured.ok);
    if (stamped) {
      lines.push(`  ${stamped}`);
    }
    return lines.join("\n");
  }

  private crossHits(areas: readonly string[], nowMs: number): { link: AimLink; abs: number; line: string }[] {
    const capped = capAreas(areas);
    const hits: { link: AimLink; abs: number; line: string }[] = [];
    for (const a of capped) {
      for (const b of capped) {
        if (a === b) {
          continue;
        }
        let got: { link: AimLink; ok: boolean };
        try {
          got = this.nextDay(a, b, nowMs);
        } catch {
          continue;
        }
        const line = formatCross(got.link, got.ok);
        if (!line) {
          continue;
        }
        hits.push({ link: got.link, abs: Math.abs(got.link.r), line });
      }
    }
    hits.sort((x, y) => (x.abs !== y.abs ? y.abs - x.abs : x.line < y.line ? -1 : x.line > y.line ? 1 : 0));
    return hits.slice(0, AIM_LINKS_MAX);
  }

  private eventById(id: number): AimEvent | null {
    const row = this.sql.one<EventRow>(
      `SELECT id, day, what, ref, metric, value, unit, source, created_at, superseded_by
       FROM aim_event WHERE id = ?`,
      id,
    );
    if (!row) {
      return null;
    }
    return this.hydrate(row);
  }

  private liveByRef(ref: string): AimEvent | null {
    const row = this.sql.one<EventRow>(
      `SELECT id, day, what, ref, metric, value, unit, source, created_at, superseded_by
       FROM aim_event WHERE ref = ? AND superseded_by IS NULL`,
      ref,
    );
    if (!row) {
      return null;
    }
    return this.hydrate(row);
  }

  private hydrate(row: EventRow): AimEvent {
    const ev = readEvent(row);
    ev.scores = this.scoresFor([ev.id]).get(ev.id) ?? [];
    return ev;
  }

  private scoresFor(ids: readonly number[]): Map<number, AimScore[]> {
    const out = new Map<number, AimScore[]>();
    if (ids.length === 0) {
      return out;
    }
    const marks = ids.map(() => "?").join(", ");
    const rows = this.sql.exec<ScoreRow>(
      `SELECT event_id, area, score, note FROM aim_score
       WHERE event_id IN (${marks})
       ORDER BY area`,
      ...ids,
    );
    for (const row of rows) {
      const id = num(row.event_id);
      if (id == null) {
        continue;
      }
      const list = out.get(id) ?? [];
      list.push({ area: text(row.area), value: num(row.score) ?? 0, note: text(row.note) });
      out.set(id, list);
    }
    return out;
  }

  private firstDay(area: string): string | null {
    const row = this.sql.one<{ day: string | null }>(
      `SELECT MIN(e.day) AS day
       FROM aim_event e
       JOIN aim_score sc ON sc.event_id = e.id
       WHERE e.superseded_by IS NULL AND sc.area = ?`,
      area,
    );
    if (!row?.day) {
      return null;
    }
    return row.day;
  }
}

/** The crane `aims` frame. An empty board still sends `aims: []`. */
export function aimsFrame(board: AimsBoard): WireFrame {
  const frame: WireFrame = { kind: "aims", aims: board.aims };
  if (board.links.length > 0) {
    frame.links = board.links;
  }
  return frame;
}

/** Open the ledger on `sql`. A null handle is the Go `OpenDB(nil)` error. */
export function openAims(
  sql: Sql | null,
  clock: Clock,
  log: Logger,
  memory: AimMemory | null = null,
): AimStore {
  if (!sql) {
    throw new AimsError("aims: nil db");
  }
  return new AimStore(sql, clock, log, memory);
}

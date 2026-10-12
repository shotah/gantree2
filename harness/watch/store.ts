import { type Clock } from "@/harness/core/clock";
import { type Logger, silentLogger } from "@/harness/core/log";
import { migrate, type Migration, type Sql, type SqlValue } from "@/harness/core/sql";
import { roomSession } from "@/harness/session/types";
import { DEFAULT_MONTHLY_READS } from "@/harness/plugins/twitter/budget";
import {
  BACKOFF_CAP_SEC,
  DEFAULT_MAX_WATCHES,
  formatDuration,
  formatRfc3339,
  MIN_INTERVAL_SEC,
  PAUSE_AFTER_ERRORS,
  snapUpGrid,
  WATCH_WAKE_MAX_ITEMS,
} from "./interval";
import { isRecord, isUnknownArray, parseJson } from "./json";
import { pollDueWatches, type CallTool, type OnNewItems } from "./poll";
import { errorText, goQuote } from "./quote";

/**
 * One polled subscription. Times are ms since epoch.
 * `args` is canonical JSON object text (`{}` when the input was empty or not an object).
 */
export type Watch = {
  id: number;
  tool: string;
  args: string;
  label: string;
  intervalSeconds: number;
  /** Column `next_poll_at`. */
  nextPollAt: number;
  sessionId: string;
  userId: string;
  chatId: string;
  threadId: number;
  seenIds: string[];
  enabled: boolean;
  running: boolean;
  /** `active` polls. `paused` stays listed until `watch_add` of the same source. */
  state: string;
  /** Configured interval. Success restores `intervalSeconds` to this. */
  baseIntervalSeconds: number;
  consecutiveErrors: number;
  etag: string;
  lastModified: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastError: string;
};

/** First awake instant when `at` is inside quiet hours, otherwise null. */
export type QuietHours = {
  resumeAt(at: number): number | null;
};

/** Conversation a watch is added from. User, chat, and thread are not stored. */
export type WatchDelivery = {
  sessionId: string;
  userId?: string;
  chatId?: string;
  threadId?: number;
};

const WATCH_SELECT = `SELECT id, tool, args, label, interval_seconds, base_interval_seconds, next_poll_at,
  session_id, user_id, chat_id, thread_id, seen_ids,
  enabled, running, state, consecutive_errors, etag, last_modified,
  created_at, updated_at, last_run_at, last_error
  FROM watch`;

export const watchMigrations: Migration[] = [
  {
    id: "watch.001",
    up: [
      `CREATE TABLE IF NOT EXISTS watch (
        id               INTEGER PRIMARY KEY,
        tool             TEXT NOT NULL,
        args             TEXT NOT NULL DEFAULT '{}',
        label            TEXT NOT NULL DEFAULT '',
        interval_seconds INTEGER NOT NULL,
        next_poll_at     INTEGER NOT NULL,
        session_id       TEXT NOT NULL,
        user_id          TEXT NOT NULL DEFAULT '',
        chat_id          TEXT NOT NULL DEFAULT '',
        thread_id        INTEGER NOT NULL DEFAULT 0,
        seen_ids         TEXT NOT NULL DEFAULT '[]',
        enabled          INTEGER NOT NULL DEFAULT 1,
        running          INTEGER NOT NULL DEFAULT 0,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        last_run_at      INTEGER,
        last_error       TEXT NOT NULL DEFAULT ''
      )`,
    ],
  },
  {
    id: "watch.002",
    up: [
      `CREATE INDEX IF NOT EXISTS idx_watch_due
        ON watch(enabled, running, next_poll_at)`,
    ],
  },
  {
    id: "watch.003",
    up: [
      "ALTER TABLE watch ADD COLUMN base_interval_seconds INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE watch ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE watch ADD COLUMN state TEXT NOT NULL DEFAULT 'active'",
      "ALTER TABLE watch ADD COLUMN etag TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE watch ADD COLUMN last_modified TEXT NOT NULL DEFAULT ''",
      "UPDATE watch SET base_interval_seconds = interval_seconds WHERE base_interval_seconds = 0",
    ],
  },
];

type WatchRow = {
  id: SqlValue;
  tool: SqlValue;
  args: SqlValue;
  label: SqlValue;
  interval_seconds: SqlValue;
  base_interval_seconds: SqlValue;
  next_poll_at: SqlValue;
  session_id: SqlValue;
  user_id: SqlValue;
  chat_id: SqlValue;
  thread_id: SqlValue;
  seen_ids: SqlValue;
  enabled: SqlValue;
  running: SqlValue;
  state: SqlValue;
  consecutive_errors: SqlValue;
  etag: SqlValue;
  last_modified: SqlValue;
  created_at: SqlValue;
  updated_at: SqlValue;
  last_run_at: SqlValue;
  last_error: SqlValue;
};

/**
 * Watches in the agent SQLite. Constructing applies `watch.001`… and collapses
 * leftover mouth sessions onto the room session id (that rewrite runs on every
 * open, so it is not a one-shot migration id).
 */
export class WatchStore {
  readonly sql: Sql;
  readonly clock: Clock;
  readonly log: Logger;
  /** Active-watch cap. */
  readonly maxWatches: number;
  /** Sleep / quiet windows. Unset means always awake. */
  quiet: QuietHours | null = null;
  /** `X_MONTHLY_READS`. The poller skips twitter watches at this cap. */
  twitterReadLimit = DEFAULT_MONTHLY_READS;
  /** Combined wake text cap. */
  wakeMax = WATCH_WAKE_MAX_ITEMS;
  private readonly sessionId: string;

  constructor(
    sql: Sql | null,
    clock: Clock,
    maxWatches = DEFAULT_MAX_WATCHES,
    log: Logger = silentLogger,
    sessionId = "agent",
  ) {
    if (sql === null || sql === undefined) throw new Error("watch: nil db");
    this.sql = sql;
    this.clock = clock;
    this.log = log;
    this.maxWatches = maxWatches < 1 ? DEFAULT_MAX_WATCHES : maxWatches;
    this.sessionId = roomSession(sessionId);
    migrate(sql, watchMigrations);
    this.collapseSessions();
  }

  /** Enabled watches. */
  activeCount(): number {
    const row = this.sql.one<{ n: SqlValue }>("SELECT COUNT(*) AS n FROM watch WHERE enabled = 1");
    return row ? asNumber(row.n) : 0;
  }

  /**
   * Insert a watch. The next poll is now so the first tick can seed the cursor.
   * `intervalSeconds` must be >= 60. User, chat, and thread are stored empty.
   */
  add(tool: string, args: unknown, label: string, intervalSeconds: number, delivery: WatchDelivery): Watch {
    const name = tool.trim();
    validateTool(name);
    if (delivery.sessionId === "") throw new Error("watch: delivery session_id is required");
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SEC) {
      throw new Error(`watch: interval must be >= ${formatDuration(MIN_INTERVAL_SEC)}`);
    }
    const argsJson = normalizeArgs(args);
    if (this.activeCount() >= this.maxWatches) {
      throw new Error(`watch: max active watches (${this.maxWatches}) reached`);
    }
    const now = this.clock.now();
    const interval = Math.trunc(intervalSeconds);
    const rows = this.sql.exec<{ id: SqlValue }>(
      `INSERT INTO watch (
        tool, args, label, interval_seconds, base_interval_seconds, next_poll_at,
        session_id, user_id, chat_id, thread_id,
        seen_ids, enabled, running, state, consecutive_errors, etag, last_modified,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', 0, '[]', 1, 0, 'active', 0, '', '', ?, ?)
      RETURNING id`,
      name,
      argsJson,
      label.trim(),
      interval,
      interval,
      this.notBefore(now),
      delivery.sessionId,
      now,
      now,
    );
    const id = rows[0] ? asNumber(rows[0].id) : 0;
    if (id === 0) throw new Error("watch: insert: missing id");
    return this.get(id);
  }

  get(id: number): Watch {
    const row = this.sql.one<WatchRow>(`${WATCH_SELECT} WHERE id = ?`, id);
    if (!row) throw new Error(`watch: ${id} not found`);
    return scanWatch(row);
  }

  /** `sessionId` empty lists every session. Disabled rows are omitted unless asked for. */
  listSession(sessionId: string, includeDisabled: boolean): Watch[] {
    const where = ["1 = 1"];
    const params: SqlValue[] = [];
    if (!includeDisabled) where.push("enabled = 1");
    if (sessionId !== "") {
      where.push("session_id = ?");
      params.push(sessionId);
    }
    const rows = this.sql.exec<WatchRow>(
      `${WATCH_SELECT} WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 100`,
      ...params,
    );
    return rows.map(scanWatch);
  }

  /** Reset `running = 1` left by a crash. Returns how many rows changed. */
  clearStaleRunning(now = this.clock.now()): number {
    return this.write("UPDATE watch SET running = 0, updated_at = ? WHERE running = 1", now);
  }

  cancel(id: number, now = this.clock.now()): void {
    const n = this.write(
      "UPDATE watch SET enabled = 0, running = 0, updated_at = ? WHERE id = ?",
      now,
      id,
    );
    if (n === 0) throw new Error(`watch: ${id} not found`);
  }

  /** Enabled, idle, active watches with `next_poll_at <= now`. `limit < 1` means 10. */
  due(now: number, limit: number): Watch[] {
    const n = limit < 1 ? 10 : limit;
    return this.sql.exec<WatchRow>(
      `${WATCH_SELECT}
        WHERE enabled = 1 AND state = 'active' AND running = 0 AND next_poll_at <= ?
        ORDER BY next_poll_at ASC, id ASC LIMIT ?`,
      now,
      n,
    ).map(scanWatch);
  }

  /** Every enabled, idle, active watch that is due. One alarm polls all of them. */
  dueAll(now: number): Watch[] {
    return this.sql.exec<WatchRow>(
      `${WATCH_SELECT}
        WHERE enabled = 1 AND state = 'active' AND running = 0 AND next_poll_at <= ?
        ORDER BY next_poll_at ASC, id ASC`,
      now,
    ).map(scanWatch);
  }

  /** Mark a watch running if it is still due, idle, and not paused. */
  claim(id: number, now: number): boolean {
    const n = this.write(
      `UPDATE watch SET running = 1, updated_at = ?
        WHERE id = ? AND enabled = 1 AND state = 'active' AND running = 0 AND next_poll_at <= ?`,
      now,
      id,
      now,
    );
    return n === 1;
  }

  /**
   * Clear running and store the cursor. A fetch error backs off; a clean poll
   * restores the configured interval and snaps the next due time to the grid.
   * `seen === null` keeps the current cursor. Does not re-enable a watch
   * cancelled while it was claimed (the update matches `running = 1` only).
   */
  finish(w: Watch, seen: string[] | null, err: unknown, now = this.clock.now()): void {
    if (err) this.finishBackoff(w, seen, err, now);
    else this.finishOk(w, seen, now);
  }

  /**
   * Successful fetch. Restores the configured interval, clears the error
   * streak, and stores validators when the response sent them.
   * `lastError` is set when the fetch worked but the model turn did not.
   */
  finishOk(
    w: Watch,
    seen: string[] | null,
    now = this.clock.now(),
    meta?: { etag?: string; lastModified?: string; lastError?: string },
  ): void {
    const base = w.baseIntervalSeconds >= MIN_INTERVAL_SEC ? w.baseIntervalSeconds : Math.max(w.intervalSeconds, MIN_INTERVAL_SEC);
    const when = this.notBefore(now + base * 1000);
    const etag = meta?.etag ? meta.etag : w.etag;
    const lastModified = meta?.lastModified ? meta.lastModified : w.lastModified;
    this.write(
      `UPDATE watch SET
        running = 0,
        enabled = CASE WHEN enabled = 0 THEN 0 ELSE 1 END,
        state = CASE WHEN enabled = 0 THEN state ELSE 'active' END,
        seen_ids = ?,
        next_poll_at = ?,
        last_run_at = ?,
        last_error = ?,
        updated_at = ?,
        consecutive_errors = 0,
        interval_seconds = ?,
        etag = ?,
        last_modified = ?
      WHERE id = ? AND running = 1`,
      JSON.stringify(seen ?? w.seenIds),
      when,
      now,
      clip(meta?.lastError ?? ""),
      now,
      base,
      etag,
      lastModified,
      w.id,
    );
  }

  /**
   * A fetch error doubles the interval (cap 24h) and increments
   * `consecutive_errors`. The fifth error pauses the watch.
   */
  finishBackoff(w: Watch, seen: string[] | null, err: unknown, now = this.clock.now()): void {
    const errors = w.consecutiveErrors + 1;
    const current = Math.max(w.intervalSeconds, MIN_INTERVAL_SEC);
    const nextInterval = Math.min(current * 2, BACKOFF_CAP_SEC);
    const paused = errors >= PAUSE_AFTER_ERRORS;
    const when = this.notBefore(now + nextInterval * 1000);
    this.write(
      `UPDATE watch SET
        running = 0,
        state = CASE WHEN ? = 1 THEN 'paused' ELSE state END,
        consecutive_errors = ?,
        interval_seconds = ?,
        seen_ids = ?,
        next_poll_at = ?,
        last_run_at = ?,
        last_error = ?,
        updated_at = ?
      WHERE id = ? AND running = 1`,
      paused ? 1 : 0,
      errors,
      nextInterval,
      JSON.stringify(seen ?? w.seenIds),
      when,
      now,
      clip(err),
      now,
      w.id,
    );
    if (paused) {
      this.log.info("watch paused", { id: w.id, tool: w.tool, errors });
    }
  }

  /** `finish` with an explicit next poll — a budget refusal parks until then. No backoff. */
  finishAt(w: Watch, seen: string[] | null, err: unknown, next: number, now = this.clock.now()): void {
    const at = this.notBefore(next < now ? now : next);
    this.write(
      `UPDATE watch SET
        running = 0,
        enabled = CASE WHEN enabled = 0 THEN 0 ELSE 1 END,
        seen_ids = ?,
        next_poll_at = ?,
        last_run_at = ?,
        last_error = ?,
        updated_at = ?
      WHERE id = ? AND running = 1`,
      JSON.stringify(seen ?? w.seenIds),
      at,
      now,
      clip(err),
      now,
      w.id,
    );
  }

  /**
   * Push a watch to `next` without a fetch and without touching the error streak.
   * Used when twitter reads are over budget. The row does not need to be claimed.
   */
  parkUntil(w: Watch, next: number, err: unknown, now = this.clock.now()): void {
    const when = this.notBefore(Math.max(next, now));
    this.write(
      `UPDATE watch SET running = 0, next_poll_at = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND enabled = 1 AND state = 'active'`,
      when,
      clip(err),
      now,
      w.id,
    );
  }

  /** Move every due active watch to `until` without fetching. Quiet hours use this. */
  deferDue(until: number, now: number): number {
    return this.write(
      `UPDATE watch SET running = 0, next_poll_at = ?, updated_at = ?
        WHERE enabled = 1 AND state = 'active' AND next_poll_at <= ?`,
      until,
      now,
      now,
    );
  }

  /** Newest paused row with the same tool and canonical args, if any. */
  findPaused(tool: string, args: unknown): Watch | null {
    const row = this.sql.one<WatchRow>(
      `${WATCH_SELECT}
        WHERE enabled = 1 AND state = 'paused' AND tool = ? AND args = ?
        ORDER BY id DESC LIMIT 1`,
      tool.trim(),
      normalizeArgs(args),
    );
    return row ? scanWatch(row) : null;
  }

  /** Clear a pause, restore a configured interval, and schedule the next grid slot. */
  resume(id: number, intervalSeconds: number, label: string): Watch {
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SEC) {
      throw new Error(`watch: interval must be >= ${formatDuration(MIN_INTERVAL_SEC)}`);
    }
    const now = this.clock.now();
    const interval = Math.trunc(intervalSeconds);
    const n = this.write(
      `UPDATE watch SET
        state = 'active', enabled = 1, running = 0,
        consecutive_errors = 0, last_error = '',
        interval_seconds = ?, base_interval_seconds = ?,
        label = ?, next_poll_at = ?, updated_at = ?
      WHERE id = ?`,
      interval,
      interval,
      label.trim(),
      this.notBefore(now),
      now,
      id,
    );
    if (n === 0) throw new Error(`watch: ${id} not found`);
    return this.get(id);
  }

  setQuiet(hours: QuietHours | null): void {
    this.quiet = hours;
  }

  setTwitterReadLimit(limit: number): void {
    this.twitterReadLimit = Number.isFinite(limit) && limit >= 0 ? Math.trunc(limit) : DEFAULT_MONTHLY_READS;
  }

  setWakeMax(max: number): void {
    this.wakeMax = Number.isFinite(max) && max >= 1 ? Math.trunc(max) : WATCH_WAKE_MAX_ITEMS;
  }

  /**
   * Drain due watches. `callTool` is the fetch (full JSON, not a model-truncated
   * call). `onNewItems` runs a turn only when new ids appear after the seed poll.
   */
  async pollDue(now: number, callTool: CallTool, onNewItems: OnNewItems): Promise<void> {
    this.clearStaleRunning(now);
    const resume = this.quiet?.resumeAt(now);
    if (resume != null) {
      const until = snapUpGrid(resume);
      if (until > now) {
        const moved = this.deferDue(until, now);
        this.log.info("watch batch deferred (quiet hours)", { until: formatRfc3339(until), moved });
      }
      return;
    }
    await pollDueWatches(this, now, callTool, onNewItems);
  }

  /**
   * Earliest alarm for an active watch, snapped to the grid and never inside
   * quiet hours. Includes a watch left `running` so a crashed claim still
   * schedules an alarm. A past timestamp means the Durable Object should
   * alarm immediately. Paused watches are not armed.
   */
  nextDue(): number | null {
    const row = this.sql.one<{ next: SqlValue }>(
      "SELECT MIN(next_poll_at) AS next FROM watch WHERE enabled = 1 AND state = 'active'",
    );
    if (!row || row.next === null || row.next === undefined) return null;
    return this.alarmAt(asNumber(row.next));
  }

  /** Pull `next_poll_at` a minute into the past and clear `running`. */
  forceDueForTest(id: number, now = this.clock.now()): void {
    const n = this.write(
      "UPDATE watch SET next_poll_at = ?, running = 0, updated_at = ? WHERE id = ?",
      now - 60_000,
      now,
      id,
    );
    if (n === 0) throw new Error(`watch: ${id} not found`);
  }

  /** Grid slot at or after `at`, pushed past quiet hours when that slot is asleep. */
  private notBefore(at: number): number {
    const snapped = snapUpGrid(at);
    const resume = this.quiet?.resumeAt(snapped);
    if (resume != null) return snapUpGrid(resume);
    return snapped;
  }

  /**
   * Alarm instant for a stored `next_poll_at`. Overdue work fires now unless
   * the human is in quiet hours. A future slot snaps up to the grid and, if
   * that lands in quiet hours, waits until they end.
   */
  private alarmAt(raw: number): number {
    const now = this.clock.now();
    if (raw <= now) {
      const resume = this.quiet?.resumeAt(now);
      if (resume != null) return snapUpGrid(resume);
      return raw;
    }
    const snapped = snapUpGrid(raw);
    const resume = this.quiet?.resumeAt(snapped);
    if (resume != null) return snapUpGrid(resume);
    return snapped;
  }

  private write(query: string, ...params: SqlValue[]): number {
    this.sql.exec(query, ...params);
    return this.sql.changes();
  }

  private collapseSessions(): void {
    this.sql.exec(
      `UPDATE watch SET session_id = ?, user_id = '', chat_id = '', thread_id = 0
        WHERE session_id != ? OR user_id != '' OR chat_id != '' OR thread_id != 0`,
      this.sessionId,
      this.sessionId,
    );
  }
}

function validateTool(tool: string): void {
  if (tool === "") throw new Error("watch: tool is required");
  if (!tool.includes("__")) {
    throw new Error(`watch: tool ${goQuote(tool)} must be a prefixed MCP name (server__tool)`);
  }
}

function normalizeArgs(args: unknown): string {
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed === "" || trimmed === "null") return "{}";
    try {
      return normalizeArgs(parseJson(trimmed));
    } catch {
      return "{}";
    }
  }
  if (!isRecord(args)) return "{}";
  try {
    return JSON.stringify(sortKeys(args));
  } catch {
    return "{}";
  }
}

function sortKeys(value: unknown): unknown {
  if (isUnknownArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
}

function scanWatch(row: WatchRow): Watch {
  return {
    id: asNumber(row.id),
    tool: asString(row.tool),
    args: asString(row.args),
    label: asString(row.label),
    intervalSeconds: asNumber(row.interval_seconds),
    nextPollAt: asNumber(row.next_poll_at),
    sessionId: asString(row.session_id),
    userId: asString(row.user_id),
    chatId: asString(row.chat_id),
    threadId: asNumber(row.thread_id),
    seenIds: parseSeen(asString(row.seen_ids)),
    enabled: asNumber(row.enabled) === 1,
    running: asNumber(row.running) === 1,
    state: asString(row.state) || "active",
    baseIntervalSeconds: asNumber(row.base_interval_seconds),
    consecutiveErrors: asNumber(row.consecutive_errors),
    etag: asString(row.etag),
    lastModified: asString(row.last_modified),
    createdAt: asNumber(row.created_at),
    updatedAt: asNumber(row.updated_at),
    lastRunAt: asNumberOrNull(row.last_run_at),
    lastError: asString(row.last_error),
  };
}

function parseSeen(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  try {
    const parsed = parseJson(trimmed);
    if (!isUnknownArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") return [];
      out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

function asString(v: SqlValue | undefined): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function asNumber(v: SqlValue | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function clip(err: unknown): string {
  if (err == null || err === "") return "";
  const text = typeof err === "string" ? err : errorText(err);
  return text.length > 500 ? text.slice(0, 500) : text;
}

function asNumberOrNull(v: SqlValue | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return null;
}

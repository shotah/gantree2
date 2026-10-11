import { type Clock } from "@/brain/core/clock";
import { type Logger, silentLogger } from "@/brain/core/log";
import { migrate, type Migration, type Sql, type SqlValue } from "@/brain/core/sql";
import {
  DEFAULT_INTERVAL_SEC,
  DEFAULT_MAX_WATCHES,
  formatDuration,
  MIN_INTERVAL_SEC,
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
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastError: string;
};

/** Conversation a watch is added from. User, chat, and thread are not stored. */
export type WatchDelivery = {
  sessionId: string;
  userId?: string;
  chatId?: string;
  threadId?: number;
};

/** One agent conversation. Mouth session ids collapse to this on every open. */
export const AGENT_SESSION = "gantry";

const WATCH_SELECT = `SELECT id, tool, args, label, interval_seconds, next_poll_at,
  session_id, user_id, chat_id, thread_id, seen_ids,
  enabled, running, created_at, updated_at, last_run_at, last_error
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
];

type WatchRow = {
  id: SqlValue;
  tool: SqlValue;
  args: SqlValue;
  label: SqlValue;
  interval_seconds: SqlValue;
  next_poll_at: SqlValue;
  session_id: SqlValue;
  user_id: SqlValue;
  chat_id: SqlValue;
  thread_id: SqlValue;
  seen_ids: SqlValue;
  enabled: SqlValue;
  running: SqlValue;
  created_at: SqlValue;
  updated_at: SqlValue;
  last_run_at: SqlValue;
  last_error: SqlValue;
};

/**
 * Watches in the agent SQLite. Constructing applies `watch.001`… and collapses
 * leftover mouth sessions onto `gantry` (that rewrite runs on every open, so
 * it is not a one-shot migration id).
 */
export class WatchStore {
  readonly sql: Sql;
  readonly clock: Clock;
  readonly log: Logger;
  /** Active-watch cap. */
  readonly maxWatches: number;

  constructor(sql: Sql | null, clock: Clock, maxWatches = DEFAULT_MAX_WATCHES, log: Logger = silentLogger) {
    if (sql === null || sql === undefined) throw new Error("watch: nil db");
    this.sql = sql;
    this.clock = clock;
    this.log = log;
    this.maxWatches = maxWatches < 1 ? DEFAULT_MAX_WATCHES : maxWatches;
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
    const rows = this.sql.exec<{ id: SqlValue }>(
      `INSERT INTO watch (
        tool, args, label, interval_seconds, next_poll_at,
        session_id, user_id, chat_id, thread_id,
        seen_ids, enabled, running, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', '', 0, '[]', 1, 0, ?, ?)
      RETURNING id`,
      name,
      argsJson,
      label.trim(),
      Math.trunc(intervalSeconds),
      now,
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

  /** Enabled, idle watches with `next_poll_at <= now`. `limit < 1` means 10. */
  due(now: number, limit: number): Watch[] {
    const n = limit < 1 ? 10 : limit;
    return this.sql.exec<WatchRow>(
      `${WATCH_SELECT}
        WHERE enabled = 1 AND running = 0 AND next_poll_at <= ?
        ORDER BY next_poll_at ASC LIMIT ?`,
      now,
      n,
    ).map(scanWatch);
  }

  /** Mark a watch running if it is still due and idle. */
  claim(id: number, now: number): boolean {
    const n = this.write(
      `UPDATE watch SET running = 1, updated_at = ?
        WHERE id = ? AND enabled = 1 AND running = 0 AND next_poll_at <= ?`,
      now,
      id,
      now,
    );
    return n === 1;
  }

  /**
   * Clear running, store the cursor, and schedule `now + interval`.
   * `seen === null` keeps the current cursor. Does not re-enable a watch
   * cancelled while it was claimed (the update matches `running = 1` only,
   * and a disabled row stays disabled).
   */
  finish(w: Watch, seen: string[] | null, err: unknown, now = this.clock.now()): void {
    let intervalSec = w.intervalSeconds;
    if (intervalSec < MIN_INTERVAL_SEC) intervalSec = DEFAULT_INTERVAL_SEC;
    this.finishAt(w, seen, err, now + intervalSec * 1000, now);
  }

  /** `finish` with an explicit next poll — a budget refusal parks until then. */
  finishAt(w: Watch, seen: string[] | null, err: unknown, next: number, now = this.clock.now()): void {
    let errText = err === null || err === undefined ? "" : errorText(err);
    if (errText.length > 500) errText = errText.slice(0, 500);
    const seenJson = JSON.stringify(seen ?? w.seenIds);
    const at = next < now ? now : next;
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
      seenJson,
      at,
      now,
      errText,
      now,
      w.id,
    );
  }

  /**
   * Drain due watches. `callTool` is the fetch (full JSON, not a model-truncated
   * call). `onNewItems` runs a turn only when new ids appear after the seed poll.
   */
  async pollDue(now: number, callTool: CallTool, onNewItems: OnNewItems): Promise<void> {
    await pollDueWatches(this, now, callTool, onNewItems);
  }

  /**
   * Earliest `next_poll_at` among enabled watches, or `null` when none are enabled.
   * Includes a watch left `running` so a crashed claim still schedules an alarm.
   * A past timestamp means the Durable Object should alarm immediately.
   */
  nextDue(): number | null {
    const row = this.sql.one<{ next: SqlValue }>(
      "SELECT MIN(next_poll_at) AS next FROM watch WHERE enabled = 1",
    );
    if (!row || row.next === null || row.next === undefined) return null;
    return asNumber(row.next);
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

  private write(query: string, ...params: SqlValue[]): number {
    this.sql.exec(query, ...params);
    return this.sql.changes();
  }

  private collapseSessions(): void {
    this.sql.exec(
      `UPDATE watch SET session_id = ?, user_id = '', chat_id = '', thread_id = 0
        WHERE session_id != ? OR user_id != '' OR chat_id != '' OR thread_id != 0`,
      AGENT_SESSION,
      AGENT_SESSION,
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

function asNumberOrNull(v: SqlValue | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return null;
}

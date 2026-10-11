/**
 * SQLite conversation history. One agent database, many session ids, trimmed
 * to a message count and a chars/4 token estimate. Opening the store collapses
 * leftover mouth sessions into `gantry`, the same step harness `Open` runs.
 */
import type { Clock } from "@/brain/core/clock";
import type { Logger } from "@/brain/core/log";
import { migrate, type Migration, type Sql } from "@/brain/core/sql";
import {
  agentSession,
  defaultMaxEstTokens,
  defaultMaxMessages,
  roleAssistant,
  roleUser,
  speakerAgent,
  speakerUser,
  type Message,
  type TalkState,
} from "./types";

export const sessionMigrations: Migration[] = [
  {
    id: "session.001",
    up: [
      `CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        last_speaker TEXT NOT NULL DEFAULT '',
        waiting_for_reply INTEGER NOT NULL DEFAULT 0,
        wait_nudges INTEGER NOT NULL DEFAULT 0,
        wait_set_at TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE IF NOT EXISTS session_message (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_session_message_session ON session_message (session_id, id)`,
    ],
  },
];

export type SessionOptions = {
  maxMessages?: number;
  maxEstTokens?: number;
};

/** Folds dropped turns into the durable session summary. */
export type Summarizer = {
  fold(prior: string, dropped: readonly Message[]): Promise<string>;
};

/**
 * Runs after a successful trim fold. Used to graduate new Voice material.
 * Must not fail the trim — the store logs a throw and keeps the commit.
 */
export type FoldHook = (prior: string, next: string) => void;

function bound(n: number | undefined, fallback: number): number {
  if (n == null || !Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.trunc(n);
}

function rfc3339(ms: number): string {
  return new Date(ms).toISOString();
}

function emptyTalk(): TalkState {
  return { lastSpeaker: "", waitingForReply: false, waitNudges: 0, waitSetAt: 0 };
}

/** Prompt line so the model sees who spoke and any open wait. */
export function footer(state: TalkState): string {
  if (state.lastSpeaker === "" && !state.waitingForReply && state.waitNudges === 0) {
    return "";
  }
  const speaker = state.lastSpeaker === "" ? "none" : state.lastSpeaker;
  const wait = state.waitingForReply ? "true" : "false";
  return `[conversation] last_speaker=${speaker} waiting_for_reply=${wait} wait_nudges=${String(state.waitNudges)}`;
}

/** chars/4 token estimate. Matches the trim budget on ASCII history. */
export function estTokens(msgs: readonly Message[]): number {
  let n = 0;
  for (const m of msgs) {
    n += Math.trunc((m.content.length + 3) / 4);
  }
  return n;
}

type CountRow = { n: number; chars: number };
type PeekRow = { id: number; role: string; content: string };
type TalkRow = {
  last_speaker: string;
  waiting_for_reply: number;
  wait_nudges: number;
  wait_set_at: string;
};

function collapseToAgent(sql: Sql, now: string): void {
  const sid = agentSession;
  sql.exec(
    `INSERT INTO session (id, summary, updated_at) VALUES (?, '', ?) ON CONFLICT(id) DO NOTHING`,
    sid,
    now,
  );
  const own = sql.one<{ summary: string }>(`SELECT summary FROM session WHERE id = ?`, sid);
  if ((own?.summary ?? "").trim() === "") {
    const donor = sql.one<{ summary: string }>(
      `SELECT summary FROM session WHERE summary != '' ORDER BY length(summary) DESC LIMIT 1`,
    );
    if (donor && donor.summary.trim() !== "") {
      sql.exec(`UPDATE session SET summary = ? WHERE id = ?`, donor.summary, sid);
    }
  }
  const waiting = sql.one<{ waiting_for_reply: number }>(
    `SELECT waiting_for_reply FROM session WHERE id = ?`,
    sid,
  );
  if (Number(waiting?.waiting_for_reply ?? 0) === 0) {
    const other = sql.one<TalkRow>(
      `SELECT last_speaker, waiting_for_reply, wait_nudges, wait_set_at
       FROM session WHERE id != ? ORDER BY updated_at DESC LIMIT 1`,
      sid,
    );
    if (other && Number(other.waiting_for_reply) !== 0) {
      sql.exec(
        `UPDATE session SET last_speaker = ?, waiting_for_reply = ?, wait_nudges = ?, wait_set_at = ? WHERE id = ?`,
        other.last_speaker,
        other.waiting_for_reply,
        other.wait_nudges,
        other.wait_set_at,
        sid,
      );
    }
  }
  sql.exec(`UPDATE session_message SET session_id = ? WHERE session_id != ?`, sid, sid);
  sql.exec(`DELETE FROM session WHERE id != ?`, sid);
}

export class SessionStore {
  readonly maxMessages: number;
  readonly maxEstTokens: number;
  private summarizer: Summarizer | null = null;
  private foldHook: FoldHook | null = null;

  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    private readonly log: Logger,
    options: SessionOptions = {},
  ) {
    this.maxMessages = bound(options.maxMessages, defaultMaxMessages);
    this.maxEstTokens = bound(options.maxEstTokens, defaultMaxEstTokens);
    this.sql.exec("PRAGMA foreign_keys = ON");
    migrate(this.sql, sessionMigrations);
    collapseToAgent(this.sql, rfc3339(this.clock.now()));
  }

  withSummarizer(sum: Summarizer | null): this {
    this.summarizer = sum;
    return this;
  }

  /** Call after `withSummarizer`. The hook sees the prior and next summaries. */
  withFoldHook(hook: FoldHook | null): this {
    this.foldHook = hook;
    return this;
  }

  /** Oldest first. */
  messages(sessionId: string): Message[] {
    return this.sql.exec<{ role: string; content: string }>(
      `SELECT role, content FROM session_message WHERE session_id = ? ORDER BY id ASC`,
      sessionId,
    ).map((row) => ({ role: row.role, content: row.content }));
  }

  /**
   * Writes turns and trims to the configured bounds. A summarizer fold that
   * throws keeps the history intact — rows are not deleted without a summary.
   */
  async append(sessionId: string, ...msgs: Message[]): Promise<void> {
    if (msgs.length === 0) {
      return;
    }
    const clean: Message[] = [];
    for (const m of msgs) {
      const role = m.role.trim();
      if (role !== roleUser && role !== roleAssistant) {
        throw new Error(`session: invalid role ${JSON.stringify(m.role)}`);
      }
      clean.push({ role, content: m.content });
    }
    const now = rfc3339(this.clock.now());
    this.sql.exec(
      `INSERT INTO session (id, summary, updated_at) VALUES (?, '', ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      sessionId,
      now,
    );
    for (const m of clean) {
      this.sql.exec(
        `INSERT INTO session_message (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
        sessionId,
        m.role,
        m.content,
        now,
      );
    }
    const last = clean[clean.length - 1];
    if (last) {
      const speaker = last.role === roleUser ? speakerUser : speakerAgent;
      this.sql.exec(`UPDATE session SET last_speaker = ? WHERE id = ?`, speaker, sessionId);
    }

    const { dropped, ids } = this.planTrim(sessionId);
    let foldedPrior = "";
    let foldedNext = "";
    if (ids.length > 0) {
      if (this.summarizer) {
        const prior = this.summary(sessionId);
        try {
          const next = await this.summarizer.fold(prior, dropped);
          this.deleteIds(ids);
          this.sql.exec(
            `UPDATE session SET summary = ?, updated_at = ? WHERE id = ?`,
            next,
            now,
            sessionId,
          );
          foldedPrior = prior;
          foldedNext = next;
        } catch (err) {
          this.log.warn("session summary fold failed; skipping trim", {
            session_id: sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        this.deleteIds(ids);
      }
    }
    if (this.foldHook && foldedNext !== "") {
      try {
        this.foldHook(foldedPrior, foldedNext);
      } catch (err) {
        this.log.warn("session fold hook failed", {
          session_id: sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Deletes history and summary for `sessionId`. */
  reset(sessionId: string): void {
    this.sql.exec(`DELETE FROM session_message WHERE session_id = ?`, sessionId);
    this.sql.exec(`DELETE FROM session WHERE id = ?`, sessionId);
  }

  stats(sessionId: string): { messages: number; estTokens: number } {
    const msgs = this.messages(sessionId);
    return { messages: msgs.length, estTokens: estTokens(msgs) };
  }

  /**
   * When the last human message landed. Cron-injected turns (`[cron]…`) are
   * ignored. `null` for a fresh session or an unparseable timestamp.
   */
  lastUserAt(sessionId: string): number | null {
    const row = this.sql.one<{ created_at: string }>(
      `SELECT created_at FROM session_message
       WHERE session_id = ? AND role = ?
         AND content NOT LIKE '[cron]%'
       ORDER BY id DESC LIMIT 1`,
      sessionId,
      roleUser,
    );
    if (!row) {
      return null;
    }
    const t = Date.parse(row.created_at);
    return Number.isNaN(t) ? null : t;
  }

  /** True when a human message exists at or after `sinceMs`. Cron turns do not count. */
  userActiveSince(sessionId: string, sinceMs: number): boolean {
    const t = this.lastUserAt(sessionId);
    if (t == null) {
      return false;
    }
    return t >= sinceMs;
  }

  summary(sessionId: string): string {
    const row = this.sql.one<{ summary: string }>(`SELECT summary FROM session WHERE id = ?`, sessionId);
    return row?.summary ?? "";
  }

  /** Missing session is a zero value. */
  talkState(sessionId: string): TalkState {
    const id = sessionId.trim();
    if (id === "") {
      return emptyTalk();
    }
    const row = this.sql.one<TalkRow>(
      `SELECT last_speaker, waiting_for_reply, wait_nudges, wait_set_at FROM session WHERE id = ?`,
      id,
    );
    if (!row) {
      return emptyTalk();
    }
    let waitSetAt = 0;
    const setAt = row.wait_set_at.trim();
    if (setAt !== "") {
      const t = Date.parse(setAt);
      if (!Number.isNaN(t)) {
        waitSetAt = t;
      }
    }
    return {
      lastSpeaker: row.last_speaker,
      waitingForReply: Number(row.waiting_for_reply) !== 0,
      waitNudges: Number(row.wait_nudges),
      waitSetAt,
    };
  }

  /** Marks the agent as waiting for a human reply and resets the nudge count. */
  armWait(sessionId: string): void {
    const id = sessionId.trim();
    if (id === "") {
      throw new Error("session: empty session_id");
    }
    const now = rfc3339(this.clock.now());
    this.sql.exec(
      `INSERT INTO session (id, summary, updated_at, last_speaker, waiting_for_reply, wait_nudges, wait_set_at)
       VALUES (?, '', ?, ?, 1, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_speaker = excluded.last_speaker,
         waiting_for_reply = 1,
         wait_nudges = 0,
         wait_set_at = excluded.wait_set_at,
         updated_at = excluded.updated_at`,
      id,
      now,
      speakerAgent,
      now,
    );
  }

  /** Drops the follow-up campaign. `last_speaker` is left as-is. */
  clearWait(sessionId: string): void {
    const id = sessionId.trim();
    if (id === "") {
      return;
    }
    const now = rfc3339(this.clock.now());
    this.sql.exec(
      `UPDATE session SET waiting_for_reply = 0, wait_nudges = 0, wait_set_at = '', updated_at = ? WHERE id = ?`,
      now,
      id,
    );
  }

  /** Increments `wait_nudges` when still waiting. No-op otherwise. */
  bumpWaitNudge(sessionId: string): TalkState {
    const id = sessionId.trim();
    if (id === "") {
      return emptyTalk();
    }
    const now = rfc3339(this.clock.now());
    this.sql.exec(
      `UPDATE session SET wait_nudges = wait_nudges + 1, updated_at = ? WHERE id = ? AND waiting_for_reply = 1`,
      now,
      id,
    );
    return this.talkState(id);
  }

  private planTrim(sessionId: string): { dropped: Message[]; ids: number[] } {
    const dropped: Message[] = [];
    const ids: number[] = [];
    let skipChars = 0;
    const seed = this.sql.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM session_message WHERE session_id = ?`,
      sessionId,
    );
    const cap = Number(seed?.n ?? 0) + 1;
    for (let i = 0; i < cap; i++) {
      const stats = this.sql.one<CountRow>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)), 0) AS chars
         FROM session_message WHERE session_id = ?`,
        sessionId,
      );
      const count = Number(stats?.n ?? 0);
      const chars = Number(stats?.chars ?? 0);
      const remain = count - ids.length;
      const est = Math.trunc((chars - skipChars + 3) / 4);
      if (remain <= this.maxMessages && est <= this.maxEstTokens) {
        return { dropped, ids };
      }
      if (remain <= 2) {
        return { dropped, ids };
      }
      const row = this.sql.one<PeekRow>(
        `SELECT id, role, content FROM session_message
         WHERE session_id = ?
         ORDER BY id ASC
         LIMIT 1 OFFSET ?`,
        sessionId,
        ids.length,
      );
      if (!row) {
        return { dropped, ids };
      }
      ids.push(Number(row.id));
      skipChars += row.content.length;
      dropped.push({ role: row.role, content: row.content });
    }
    return { dropped, ids };
  }

  private deleteIds(ids: readonly number[]): void {
    for (const id of ids) {
      this.sql.exec(`DELETE FROM session_message WHERE id = ?`, id);
    }
  }
}

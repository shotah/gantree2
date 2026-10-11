/**
 * SQLite + FTS5 memory. Recall orders by FTS5 `rank` (bm25, lower is closer)
 * then `updated_at` descending. Same kind+subject on a durable row supersedes
 * the live one; episodes stay as their own rows and expire after 30 days.
 *
 * `applyConsolidation` writes statement by statement. The SQL surface has no
 * transaction API — a mid-pass failure can leave the rows already inserted.
 */
import { type Clock } from "@/brain/core/clock";
import { type Logger } from "@/brain/core/log";
import { migrate, type Sql, type SqlRow, type SqlValue } from "@/brain/core/sql";
import { ensureConsolidateAttempts, memoryMigrations } from "./schema";
import { rfc3339 } from "./time";
import {
  CONSOLIDATED_QUARANTINE,
  DEFAULT_HYDRATE_LIMIT,
  DEFAULT_RECALL_LIMIT,
  EPISODE_TTL_MS,
  HORIZON_FETCH,
  KIND_EPISODE,
  KIND_FACT,
  KIND_INSIGHT,
  KIND_PERSON,
  KIND_PREFERENCE,
  MAX_CONSOLIDATE_ATTEMPTS,
  SOURCE_CHAT,
  SOURCE_CONSOLIDATION,
  type ConsolidateItem,
  type Entry,
  type MemoryBackend,
  type StatsSnapshot,
  validateKind,
} from "./types";

const SELECT_ENTRY = `SELECT id, kind, subject, content, source, confidence, created_at, updated_at, expires_at, superseded_by`;

const SELECT_JOIN = `SELECT m.id, m.kind, m.subject, m.content, m.source, m.confidence, m.created_at, m.updated_at, m.expires_at, m.superseded_by`;

export class MemoryStore implements MemoryBackend {
  private readonly log: Logger;

  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    log: Logger,
  ) {
    this.log = log.with({ pkg: "memory" });
    const applied = migrate(this.sql, memoryMigrations);
    ensureConsolidateAttempts(this.sql);
    if (applied.length > 0) {
      this.log.info("memory migrated", { applied });
    }
  }

  stats(): StatsSnapshot {
    const now = this.nowStamp();
    const byKind: Record<string, number> = {
      [KIND_FACT]: 0,
      [KIND_PREFERENCE]: 0,
      [KIND_PERSON]: 0,
      [KIND_INSIGHT]: 0,
      [KIND_EPISODE]: 0,
    };
    let total = 0;
    for (const row of this.sql.exec("SELECT kind, COUNT(*) AS n FROM memory GROUP BY kind")) {
      const kind = asString(row.kind);
      const n = asNumber(row.n);
      byKind[kind] = n;
      total += n;
    }
    const state = this.sql.one(
      `SELECT
        COALESCE(SUM(CASE WHEN superseded_by IS NOT NULL THEN 1 ELSE 0 END), 0) AS superseded,
        COALESCE(SUM(CASE WHEN superseded_by IS NULL AND expires_at IS NOT NULL AND expires_at <= ? THEN 1 ELSE 0 END), 0) AS expired,
        COALESCE(SUM(CASE WHEN superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END), 0) AS active
      FROM memory`,
      now,
      now,
    );
    if (!state) {
      throw new Error("memory: stats state");
    }
    const backlog = this.sql.one(
      `SELECT COUNT(*) AS n FROM memory
       WHERE kind = ? AND consolidated = 0 AND superseded_by IS NULL
         AND consolidate_attempts < ?`,
      KIND_EPISODE,
      MAX_CONSOLIDATE_ATTEMPTS,
    );
    const quarantined = this.sql.one(
      `SELECT COUNT(*) AS n FROM memory
       WHERE kind = ? AND (consolidated = ? OR consolidate_attempts >= ?)`,
      KIND_EPISODE,
      CONSOLIDATED_QUARANTINE,
      MAX_CONSOLIDATE_ATTEMPTS,
    );
    const pages = this.sql.one("PRAGMA page_count");
    const size = this.sql.one("PRAGMA page_size");
    if (!backlog || !quarantined || !pages || !size) {
      throw new Error("memory: stats");
    }
    return {
      total,
      byKind,
      active: asNumber(state.active),
      expired: asNumber(state.expired),
      superseded: asNumber(state.superseded),
      backlog: asNumber(backlog.n),
      quarantined: asNumber(quarantined.n),
      dbBytes: asNumber(pages.page_count) * asNumber(size.page_size),
    };
  }

  /**
   * Insert one row. Durable kinds with the same kind+subject supersede the
   * previous live row (history stays). Episodes never collapse.
   */
  store(kind: string, subject: string, content: string): Entry {
    const k = validateKind(kind);
    const sub = subject.trim();
    const body = content.trim();
    if (sub === "" || body === "") {
      throw new Error("memory: subject and content are required");
    }
    const old = k === KIND_EPISODE ? null : this.activeByKindSubject(k, sub);
    const nowMs = this.clock.now();
    const now = rfc3339(nowMs);
    const expires = k === KIND_EPISODE ? rfc3339(nowMs + EPISODE_TTL_MS) : null;
    const inserted = this.sql.exec(
      `INSERT INTO memory (kind, subject, content, source, confidence, created_at, updated_at, expires_at, consolidated)
       VALUES (?, ?, ?, ?, 1.0, ?, ?, ?, 0)
       RETURNING id`,
      k,
      sub,
      body,
      SOURCE_CHAT,
      now,
      now,
      expires,
    );
    const id = asNumber(inserted[0]?.id);
    if (id === 0) {
      throw new Error("memory: store: no id");
    }
    const entry = this.get(id);
    if (old && old.id !== entry.id) {
      this.supersede(old.id, entry.id);
    }
    return entry;
  }

  /** Row by id, including superseded and expired. */
  get(id: number): Entry {
    const row = this.sql.one(`${SELECT_ENTRY} FROM memory WHERE id = ?`, id);
    if (!row) {
      throw new Error(`memory: id ${id} not found`);
    }
    return scan(row);
  }

  /** Live row for kind+subject, or null. */
  activeByKindSubject(kind: string, subject: string): Entry | null {
    const k = kind.trim().toLowerCase();
    const sub = subject.trim();
    if (k === "" || sub === "") {
      return null;
    }
    const row = this.sql.one(
      `${SELECT_ENTRY} FROM memory
       WHERE kind = ? AND subject = ? AND superseded_by IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      k,
      sub,
      this.nowStamp(),
    );
    return row ? scan(row) : null;
  }

  /**
   * Live rows whose subject starts with `prefix`, newest `updated_at` first.
   * `limit < 1` uses the horizon window. Empty kind or prefix returns `[]`.
   */
  listBySubjectPrefix(kind: string, prefix: string, limit: number): Entry[] {
    const k = kind.trim().toLowerCase();
    const pre = prefix.trim();
    if (k === "" || pre === "") {
      return [];
    }
    const cap = limit < 1 ? HORIZON_FETCH : limit;
    return this.sql.exec(
      `${SELECT_ENTRY} FROM memory
       WHERE kind = ? AND subject LIKE ? AND superseded_by IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY updated_at DESC
       LIMIT ?`,
      k,
      `${pre}%`,
      this.nowStamp(),
      cap,
    ).map(scan);
  }

  /** FTS5 + recency. An empty query lists active rows, newest first. */
  recall(query: string, limit: number): Entry[] {
    const cap = limit < 1 ? DEFAULT_RECALL_LIMIT : limit;
    const q = query.trim();
    if (q === "") {
      return this.listActive(cap);
    }
    return this.searchRanked(q, cap);
  }

  forget(id: number): void {
    this.sql.exec("DELETE FROM memory WHERE id = ?", id);
    if (this.sql.changes() === 0) {
      throw new Error(`memory: id ${id} not found`);
    }
  }

  /** Delete FTS matches. Empty query throws. */
  forgetQuery(query: string): number {
    const q = query.trim();
    if (q === "") {
      throw new Error("memory: forget query is required");
    }
    const entries = this.searchRanked(q, 100);
    let n = 0;
    for (const e of entries) {
      this.forget(e.id);
      n += 1;
    }
    return n;
  }

  /**
   * Active durable rows plus FTS hits for `query`. About a third of the slots
   * stay reserved for the query so preferences cannot starve a relevant hit.
   */
  hydrate(query: string, limit: number): Entry[] {
    const cap = limit < 1 ? DEFAULT_HYDRATE_LIMIT : limit;
    const seen = new Set<number>();
    const out: Entry[] = [];
    const add = (list: Entry[]) => {
      for (const e of list) {
        if (seen.has(e.id)) {
          continue;
        }
        seen.add(e.id);
        out.push(e);
        if (out.length >= cap) {
          return;
        }
      }
    };
    let durableCap = cap;
    let queryCap = 0;
    const q = query.trim();
    if (q !== "") {
      queryCap = Math.floor(cap / 3);
      if (queryCap < 1) {
        queryCap = 1;
      }
      durableCap = cap - queryCap;
      if (durableCap < 1) {
        durableCap = 1;
        queryCap = cap - 1;
      }
    }
    add(this.listDurable(durableCap));
    if (queryCap > 0) {
      add(this.searchRanked(q, queryCap + out.length));
    }
    return out.slice(0, cap);
  }

  /** Episodes still waiting on the consolidator, oldest first. */
  listUnconsolidatedEpisodes(limit: number): Entry[] {
    const cap = limit < 1 ? DEFAULT_RECALL_LIMIT : limit;
    return this.sql.exec(
      `${SELECT_ENTRY} FROM memory
       WHERE kind = ? AND consolidated = 0 AND superseded_by IS NULL
         AND consolidate_attempts < ?
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at ASC
       LIMIT ?`,
      KIND_EPISODE,
      MAX_CONSOLIDATE_ATTEMPTS,
      this.nowStamp(),
      cap,
    ).map(scan);
  }

  markConsolidated(ids: readonly number[]): void {
    for (const id of ids) {
      this.sql.exec(
        "UPDATE memory SET consolidated = 1, updated_at = ? WHERE id = ?",
        this.nowStamp(),
        id,
      );
    }
  }

  /** Consolidation-sourced row. Does not supersede a same-subject live row. */
  storeConsolidated(kind: string, subject: string, content: string): Entry {
    const k = validateKind(kind);
    const now = this.nowStamp();
    const inserted = this.sql.exec(
      `INSERT INTO memory (kind, subject, content, source, confidence, created_at, updated_at, consolidated)
       VALUES (?, ?, ?, ?, 1.0, ?, ?, 1)
       RETURNING id`,
      k,
      subject.trim(),
      content.trim(),
      SOURCE_CONSOLIDATION,
      now,
      now,
    );
    const id = asNumber(inserted[0]?.id);
    if (id === 0) {
      throw new Error("memory: store: no id");
    }
    return this.get(id);
  }

  /** Link `oldId` → `newId` without deleting. */
  supersede(oldId: number, newId: number): void {
    this.sql.exec(
      "UPDATE memory SET superseded_by = ?, updated_at = ? WHERE id = ?",
      newId,
      this.nowStamp(),
      oldId,
    );
  }

  /**
   * LIKE fallback when FTS `MATCH` throws. Also the path tests call directly.
   * `%` and `_` in `query` stay wildcards, matching the harness.
   */
  searchLike(query: string, limit: number): Entry[] {
    const like = `%${query}%`;
    return this.sql.exec(
      `${SELECT_ENTRY} FROM memory
       WHERE superseded_by IS NULL
         AND NOT (kind = ? AND consolidated != 0)
         AND (expires_at IS NULL OR expires_at > ?)
         AND (subject LIKE ? OR content LIKE ?)
       ORDER BY updated_at DESC
       LIMIT ?`,
      KIND_EPISODE,
      this.nowStamp(),
      like,
      like,
      limit,
    ).map(scan);
  }

  /**
   * Store durable rows and mark the episode batch done.
   * `allowed` restricts supersede targets to the prompted episode ids.
   */
  applyConsolidation(episodeIds: readonly number[], items: readonly ConsolidateItem[], allowed: ReadonlySet<number>): number {
    const now = this.nowStamp();
    let stored = 0;
    for (const item of items) {
      let kind = item.kind.trim().toLowerCase();
      if (kind === "") {
        kind = KIND_FACT;
      }
      if (!isDurableKind(kind)) {
        continue;
      }
      const subject = item.subject.trim();
      const content = item.content.trim();
      if (subject === "" || content === "") {
        continue;
      }
      const inserted = this.sql.exec(
        `INSERT INTO memory (kind, subject, content, source, confidence, created_at, updated_at, consolidated)
         VALUES (?, ?, ?, ?, 1.0, ?, ?, 1)
         RETURNING id`,
        kind,
        subject,
        content,
        SOURCE_CONSOLIDATION,
        now,
        now,
      );
      const newId = asNumber(inserted[0]?.id);
      if (newId === 0) {
        throw new Error("memory: store: no id");
      }
      stored += 1;
      for (const oldId of item.supersedes) {
        if (oldId <= 0 || !allowed.has(oldId)) {
          continue;
        }
        this.sql.exec(
          "UPDATE memory SET superseded_by = ?, updated_at = ? WHERE id = ?",
          newId,
          now,
          oldId,
        );
      }
    }
    for (const id of episodeIds) {
      this.sql.exec(
        "UPDATE memory SET consolidated = 1, updated_at = ? WHERE id = ?",
        now,
        id,
      );
    }
    return stored;
  }

  /** Bump attempts; quarantine (`consolidated = 2`) once `maxAttempts` is reached. */
  recordConsolidateFailure(ids: readonly number[], maxAttempts: number): void {
    const max = maxAttempts < 1 ? MAX_CONSOLIDATE_ATTEMPTS : maxAttempts;
    const now = this.nowStamp();
    for (const id of ids) {
      this.sql.exec(
        `UPDATE memory SET
           consolidate_attempts = consolidate_attempts + 1,
           consolidated = CASE
             WHEN consolidate_attempts + 1 >= ? THEN ?
             ELSE consolidated
           END,
           updated_at = ?
         WHERE id = ? AND consolidated = 0`,
        max,
        CONSOLIDATED_QUARANTINE,
        now,
        id,
      );
    }
  }

  private nowStamp(): string {
    return rfc3339(this.clock.now());
  }

  private listActive(limit: number): Entry[] {
    return this.sql.exec(
      `${SELECT_ENTRY} FROM memory
       WHERE superseded_by IS NULL
         AND NOT (kind = ? AND consolidated != 0)
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY updated_at DESC
       LIMIT ?`,
      KIND_EPISODE,
      this.nowStamp(),
      limit,
    ).map(scan);
  }

  private listDurable(limit: number): Entry[] {
    return this.sql.exec(
      `${SELECT_ENTRY} FROM memory
       WHERE superseded_by IS NULL
         AND kind IN (?, ?, ?, ?)
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY
         CASE kind
           WHEN 'preference' THEN 0
           WHEN 'person' THEN 1
           WHEN 'fact' THEN 2
           ELSE 3
         END,
         updated_at DESC
       LIMIT ?`,
      KIND_PREFERENCE,
      KIND_PERSON,
      KIND_FACT,
      KIND_INSIGHT,
      this.nowStamp(),
      limit,
    ).map(scan);
  }

  private searchRanked(query: string, limit: number): Entry[] {
    try {
      return this.queryFts(query, limit);
    } catch (err) {
      this.log.debug("memory fts fallback", { err: err instanceof Error ? err.message : String(err) });
      return this.searchLike(query, limit);
    }
  }

  private queryFts(query: string, limit: number): Entry[] {
    return this.sql.exec(
      `${SELECT_JOIN}
       FROM memory_fts
       JOIN memory m ON m.id = memory_fts.rowid
       WHERE memory_fts MATCH ?
         AND m.superseded_by IS NULL
         AND NOT (m.kind = ? AND m.consolidated != 0)
         AND (m.expires_at IS NULL OR m.expires_at > ?)
       ORDER BY rank, m.updated_at DESC
       LIMIT ?`,
      ftsQuery(query),
      KIND_EPISODE,
      this.nowStamp(),
      limit,
    ).map(scan);
  }
}

function isDurableKind(kind: string): boolean {
  return kind === KIND_FACT || kind === KIND_PREFERENCE || kind === KIND_PERSON || kind === KIND_INSIGHT;
}

function ftsQuery(q: string): string {
  const parts = q.trim().split(/\s+/u).filter((part) => part !== "");
  if (parts.length === 0) {
    return "\"\"";
  }
  const out: string[] = [];
  for (const part of parts) {
    const cleaned = part.replaceAll("\"", "");
    if (cleaned === "") {
      continue;
    }
    out.push(`"${cleaned}"`);
  }
  if (out.length === 0) {
    return "\"\"";
  }
  return out.join(" ");
}

function scan(row: SqlRow): Entry {
  return {
    id: asNumber(row.id),
    kind: asString(row.kind),
    subject: asString(row.subject),
    content: asString(row.content),
    source: asString(row.source),
    confidence: asNumber(row.confidence),
    createdAt: parseTime(row.created_at) ?? 0,
    updatedAt: parseTime(row.updated_at) ?? 0,
    expiresAt: parseTime(row.expires_at),
    supersededBy: asOptionalId(row.superseded_by),
  };
}

function parseTime(v: SqlValue | undefined): number | null {
  if (typeof v !== "string" || v === "") {
    return null;
  }
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function asString(v: SqlValue | undefined): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: SqlValue | undefined): number {
  if (typeof v === "number") {
    return v;
  }
  if (typeof v === "bigint") {
    return Number(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asOptionalId(v: SqlValue | undefined): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  return asNumber(v);
}

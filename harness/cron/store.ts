import type { Clock } from "@/harness/core/clock";
import { migrate, type Migration, type Sql, type SqlRow, type SqlValue } from "@/harness/core/sql";
import { roomSession } from "@/harness/session/types";
import { KindDailyPlanner, KindExamples, KindExamplesPing, KindFollowUp } from "./constants";
import { FollowUpPrompt } from "./prompts";
import { advanceNext, formatPlannerAt, nextPlannerAt, parsePlannerAt } from "./schedule";
import {
  formatSpread,
  onceParsed,
  parseSpread,
  planSpreadTimes,
  type Spread,
} from "./spread";
import { addCalendarDays, atLocalHour, formatCronTime, parseCronTime, zoneOrUtc } from "./time";
import type { Delivery, Job, Parsed } from "./types";
import { followUpParsed } from "./wait";

export const migrations: Migration[] = [
  {
    id: "cron.001",
    up: [
      `CREATE TABLE IF NOT EXISTS cron_job (
        id INTEGER PRIMARY KEY,
        prompt TEXT NOT NULL,
        kind TEXT NOT NULL,
        expr TEXT NOT NULL,
        timezone TEXT NOT NULL,
        next_run_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL DEFAULT '',
        thread_id INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        running INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        memory_id INTEGER,
        memory_subject TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE INDEX IF NOT EXISTS idx_cron_due ON cron_job(enabled, running, next_run_at)`,
      `CREATE TABLE IF NOT EXISTS session_pref (
        session_id TEXT PRIMARY KEY,
        examples_enabled INTEGER NOT NULL DEFAULT 1,
        planner_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`,
    ],
  },
];

const jobColumns = `id, prompt, kind, expr, timezone, next_run_at,
  session_id, user_id, chat_id, thread_id,
  enabled, running, created_at, updated_at, last_run_at, last_error,
  memory_id, memory_subject`;

export class CronError extends Error {
  readonly notFound: boolean;
  constructor(message: string, notFound = false) {
    super(message);
    this.name = "CronError";
    this.notFound = notFound;
  }
}

export class Store {
  private readonly sessionId: string;

  constructor(
    readonly sql: Sql,
    readonly clock: Clock,
    readonly maxJobs: number,
    sessionId = "agent",
  ) {
    this.sessionId = roomSession(sessionId);
    migrate(sql, migrations);
    this.collapseAgentScope();
  }

  activeCount(): number {
    const row = this.sql.one("SELECT COUNT(*) AS n FROM cron_job WHERE enabled = 1");
    return row ? asNum(row.n) : 0;
  }

  /** Earliest enabled, idle `next_run_at`, including a time already past. Null when nothing is armed. */
  nextDue(): number | null {
    const row = this.sql.one(
      `SELECT next_run_at FROM cron_job
       WHERE enabled = 1 AND running = 0
       ORDER BY next_run_at ASC
       LIMIT 1`,
    );
    if (!row || typeof row.next_run_at !== "string" || !row.next_run_at) return null;
    return parseCronTime(row.next_run_at);
  }

  schedule(prompt: string, parsed: Parsed, delivery: Delivery): Job {
    return this.insert(prompt, parsed, delivery, 0, "");
  }

  scheduleWithPin(prompt: string, parsed: Parsed, delivery: Delivery, memoryId: number, memorySubject: string): Job {
    return this.insert(prompt, parsed, delivery, memoryId, memorySubject.trim());
  }

  list(includeDisabled: boolean): Job[] {
    return this.listSession("", includeDisabled);
  }

  listSession(sessionId: string, includeDisabled: boolean): Job[] {
    let q = `SELECT ${jobColumns} FROM cron_job WHERE 1=1`;
    const args: SqlValue[] = [];
    if (!includeDisabled) q += " AND enabled = 1";
    if (sessionId) {
      q += " AND session_id = ?";
      args.push(sessionId);
    }
    q += " ORDER BY id DESC LIMIT 100";
    return this.sql.exec(q, ...args).map(jobFromRow);
  }

  /**
   * Clears every `running=1` row. A Durable Object runs at most one `alarm()` at
   * a time and only that path calls `fireDue`, so any claim here is from a
   * crashed wake — not a live in-flight job.
   */
  clearStaleRunning(): number {
    this.sql.exec(
      "UPDATE cron_job SET running = 0, updated_at = ? WHERE running = 1",
      formatCronTime(this.clock.now()),
    );
    return this.sql.changes();
  }

  cancel(id: number): void {
    const job = this.get(id);
    this.sql.exec(
      "UPDATE cron_job SET enabled = 0, running = 0, updated_at = ? WHERE id = ?",
      formatCronTime(this.clock.now()),
      id,
    );
    if (this.sql.changes() === 0) throw new CronError(`cron: job ${id} not found`, true);
    if (job.kind === KindExamples) this.cancelExamplesPings(job.sessionId);
  }

  due(now: number, limit: number): Job[] {
    const n = limit < 1 ? 10 : limit;
    return this.sql.exec(
      `SELECT ${jobColumns}
       FROM cron_job
       WHERE enabled = 1 AND running = 0 AND next_run_at <= ?
       ORDER BY CASE WHEN kind = ? THEN 0 ELSE 1 END, next_run_at ASC
       LIMIT ?`,
      formatCronTime(now),
      KindExamples,
      n,
    ).map(jobFromRow);
  }

  claim(id: number, now: number): boolean {
    const stamp = formatCronTime(now);
    this.sql.exec(
      `UPDATE cron_job SET running = 1, updated_at = ?
       WHERE id = ? AND enabled = 1 AND running = 0 AND next_run_at <= ?`,
      stamp,
      id,
      stamp,
    );
    return this.sql.changes() === 1;
  }

  /**
   * Clears the claim. One-shots disable; repeating jobs advance.
   * A cancel that landed mid-flight stays disabled.
   * A daily planner whose clock moved during the turn keeps that new clock.
   */
  finish(job: Job, runErr: unknown): void {
    const nowMs = this.clock.now();
    const now = formatCronTime(nowMs);
    let errText = errorMessage(runErr);
    if (errText.length > 500) errText = errText.slice(0, 500);

    if (job.kind === KindDailyPlanner) {
      let fresh: Job | null;
      try {
        fresh = this.get(job.id);
      } catch {
        fresh = null;
      }
      if (fresh && fresh.expr !== job.expr) {
        this.sql.exec(
          `UPDATE cron_job SET running = 0, last_run_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND running = 1`,
          now,
          errText,
          now,
          job.id,
        );
        return;
      }
    }

    let next = 0;
    let newExpr = "";
    let again: boolean;
    try {
      const adv = advanceNext(job.kind, job.expr, job.timezone, nowMs);
      next = adv.next;
      newExpr = adv.newExpr;
      again = adv.ok;
    } catch {
      again = false;
    }
    let wantEnabled = 1;
    let nextStr = now;
    let expr = job.expr;
    if (again) {
      nextStr = formatCronTime(next);
      if (newExpr) expr = newExpr;
    } else {
      wantEnabled = 0;
    }
    this.sql.exec(
      `UPDATE cron_job SET
         running = 0,
         enabled = CASE WHEN enabled = 0 THEN 0 ELSE ? END,
         expr = ?,
         next_run_at = ?,
         last_run_at = ?,
         last_error = ?,
         updated_at = ?
       WHERE id = ? AND running = 1`,
      wantEnabled,
      expr,
      nextStr,
      now,
      errText,
      now,
      job.id,
    );
  }

  defer(id: number, until: number, reason: string): void {
    const why = reason.length > 500 ? reason.slice(0, 500) : reason;
    this.sql.exec(
      `UPDATE cron_job SET running = 0, next_run_at = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND running = 1`,
      formatCronTime(until),
      why,
      formatCronTime(this.clock.now()),
      id,
    );
  }

  get(id: number): Job {
    const row = this.sql.one(`SELECT ${jobColumns} FROM cron_job WHERE id = ?`, id);
    if (!row) throw new CronError(`cron: job ${id} not found`, true);
    return jobFromRow(row);
  }

  plannerAt(sessionId: string): string {
    const row = this.sql.one("SELECT planner_at FROM session_pref WHERE session_id = ?", sessionId);
    if (!row || typeof row.planner_at !== "string") return "";
    return row.planner_at.trim();
  }

  setPlannerAt(sessionId: string, at: string): void {
    const sid = sessionId.trim();
    if (!sid) throw new Error("cron: empty session_id");
    this.sql.exec(
      `INSERT INTO session_pref (session_id, examples_enabled, planner_at, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         planner_at = excluded.planner_at,
         updated_at = excluded.updated_at`,
      sid,
      at.trim(),
      formatCronTime(this.clock.now()),
    );
  }

  findDailyPlanner(sessionId: string): Job | null {
    const row = this.sql.one(
      `SELECT ${jobColumns} FROM cron_job
       WHERE enabled = 1 AND kind = ? AND session_id = ?
       ORDER BY id DESC LIMIT 1`,
      KindDailyPlanner,
      sessionId,
    );
    return row ? jobFromRow(row) : null;
  }

  cancelDailyPlanner(sessionId: string): number {
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind = ? AND session_id = ?`,
      formatCronTime(this.clock.now()),
      KindDailyPlanner,
      sessionId,
    );
    return this.sql.changes();
  }

  ensureDailyPlanner(prompt: string, templateIn: Parsed, delivery: Delivery): { job: Job; created: boolean } {
    const loc = zoneOrUtc(templateIn.timezone);
    const { hour, minute } = parsePlannerAt(templateIn.expr);
    const template: Parsed = {
      kind: KindDailyPlanner,
      expr: formatPlannerAt(hour, minute),
      timezone: loc,
      nextRun: templateIn.nextRun || nextPlannerAt(hour, minute, loc, this.clock.now(), null, false),
    };
    const existing = this.findDailyPlanner(delivery.sessionId);
    if (!existing) {
      const job = this.schedule(prompt, template, delivery);
      this.disableExtraPlanners(delivery.sessionId, job.id);
      return { job, created: true };
    }
    this.disableExtraPlanners(delivery.sessionId, existing.id);
    if (existing.expr === template.expr && existing.prompt === prompt) {
      return { job: existing, created: false };
    }
    if (existing.expr !== template.expr) {
      template.nextRun = nextPlannerAt(hour, minute, loc, this.clock.now(), existing.lastRunAt, existing.running);
    } else {
      template.nextRun = existing.nextRunAt;
    }
    this.rewriteDailyPlanner(existing.id, prompt, template);
    return { job: this.get(existing.id), created: false };
  }

  examplesEnabled(sessionId: string): boolean {
    const row = this.sql.one("SELECT examples_enabled FROM session_pref WHERE session_id = ?", sessionId);
    if (!row) return true;
    return asNum(row.examples_enabled) !== 0;
  }

  setExamplesEnabled(sessionId: string, on: boolean): void {
    const sid = sessionId.trim();
    if (!sid) throw new Error("cron: empty session_id");
    this.sql.exec(
      `INSERT INTO session_pref (session_id, examples_enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         examples_enabled = excluded.examples_enabled,
         updated_at = excluded.updated_at`,
      sid,
      on ? 1 : 0,
      formatCronTime(this.clock.now()),
    );
  }

  findExamples(sessionId: string): Job | null {
    const row = this.sql.one(
      `SELECT ${jobColumns} FROM cron_job
       WHERE enabled = 1 AND kind = ? AND session_id = ?
       ORDER BY id DESC LIMIT 1`,
      KindExamples,
      sessionId,
    );
    return row ? jobFromRow(row) : null;
  }

  cancelExamplesPings(sessionId: string): number {
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind = ? AND session_id = ?`,
      formatCronTime(this.clock.now()),
      KindExamplesPing,
      sessionId,
    );
    return this.sql.changes();
  }

  cancelExamplesPlannerAndPings(sessionId: string): number {
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind IN (?, ?) AND session_id = ?`,
      formatCronTime(this.clock.now()),
      KindExamples,
      KindExamplesPing,
      sessionId,
    );
    return this.sql.changes();
  }

  scheduleExamplesPings(prompt: string, delivery: Delivery, tz: string, times: number[]): number {
    const cutoff = this.clock.now() - 1000;
    let n = 0;
    for (const t of times) {
      if (t <= cutoff) continue;
      this.schedule(prompt, onceParsed(KindExamplesPing, t, tz), delivery);
      n += 1;
    }
    return n;
  }

  ensureExamples(prompt: string, templateIn: Parsed, delivery: Delivery): { job: Job; created: boolean } {
    const loc = zoneOrUtc(templateIn.timezone);
    const spec = parseSpread(templateIn.expr);
    const now = this.clock.now();
    const startToday = atLocalHour(now, loc, spec.startHour);
    const tomorrowStart = addCalendarDays(startToday, loc, 1);
    const template: Parsed = {
      kind: KindExamples,
      expr: formatSpread(spec),
      nextRun: tomorrowStart,
      timezone: loc,
    };

    let existing = this.findExamples(delivery.sessionId);
    if (existing && (existing.prompt !== prompt || existing.expr !== template.expr)) {
      this.cancel(existing.id);
      this.cancelExamplesPings(delivery.sessionId);
      existing = null;
    }
    if (!existing) {
      const job = this.schedule(prompt, template, delivery);
      this.disableExtraExamplesPlanners(delivery.sessionId, job.id);
      this.seedExamplesDay(prompt, spec, delivery, loc);
      return { job, created: true };
    }
    this.disableExtraExamplesPlanners(delivery.sessionId, existing.id);
    this.cancelStaleExamplesPings(delivery.sessionId, startToday);
    if (existing.nextRunAt >= tomorrowStart) return { job: existing, created: false };
    this.setNextRun(existing.id, template.nextRun);
    const job = { ...existing, nextRunAt: template.nextRun };
    this.seedExamplesDay(prompt, spec, delivery, loc);
    return { job, created: false };
  }

  cancelStaleExamplesPings(sessionId: string, before: number): number {
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind = ? AND session_id = ? AND next_run_at < ?`,
      formatCronTime(this.clock.now()),
      KindExamplesPing,
      sessionId,
      formatCronTime(before),
    );
    return this.sql.changes();
  }

  scheduleFollowUp(delivery: Delivery, tz: string, at: number): Job {
    const zone = tz.trim() || "UTC";
    return this.schedule(FollowUpPrompt, followUpParsed(at, zone), delivery);
  }

  cancelFollowUps(sessionId: string): number {
    const sid = sessionId.trim();
    if (!sid) return 0;
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind = ? AND session_id = ?`,
      formatCronTime(this.clock.now()),
      KindFollowUp,
      sid,
    );
    return this.sql.changes();
  }

  private insert(promptRaw: string, parsed: Parsed, delivery: Delivery, memoryId: number, memorySubject: string): Job {
    const prompt = promptRaw.trim();
    if (!prompt) throw new Error("cron: prompt is required");
    if (!delivery.sessionId) throw new Error("cron: delivery session_id is required");
    if (this.activeCount() >= this.maxJobs) {
      throw new Error(`cron: max active jobs (${this.maxJobs}) reached`);
    }
    const now = formatCronTime(this.clock.now());
    const rows = this.sql.exec(
      `INSERT INTO cron_job (
         prompt, kind, expr, timezone, next_run_at,
         session_id, user_id, chat_id, thread_id,
         enabled, running, created_at, updated_at,
         memory_id, memory_subject
       ) VALUES (?, ?, ?, ?, ?, ?, '', '', 0, 1, 0, ?, ?, ?, ?)
       RETURNING id`,
      prompt,
      parsed.kind,
      parsed.expr,
      parsed.timezone,
      formatCronTime(parsed.nextRun),
      delivery.sessionId,
      now,
      now,
      memoryId > 0 ? memoryId : null,
      memorySubject,
    );
    const id = rows[0] ? asNum(rows[0].id) : 0;
    if (!id) throw new Error("cron: insert");
    return this.get(id);
  }

  private setNextRun(id: number, next: number): void {
    const now = formatCronTime(this.clock.now());
    this.sql.exec(
      "UPDATE cron_job SET next_run_at = ?, updated_at = ? WHERE id = ?",
      formatCronTime(next),
      now,
      id,
    );
  }

  private rewriteDailyPlanner(id: number, prompt: string, parsed: Parsed): void {
    this.sql.exec(
      `UPDATE cron_job SET kind = ?, prompt = ?, expr = ?, timezone = ?, next_run_at = ?, updated_at = ?
       WHERE id = ?`,
      KindDailyPlanner,
      prompt,
      parsed.expr,
      parsed.timezone,
      formatCronTime(parsed.nextRun),
      formatCronTime(this.clock.now()),
      id,
    );
  }

  private disableExtraPlanners(sessionId: string, keepId: number): void {
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind = ? AND session_id = ? AND id != ?`,
      formatCronTime(this.clock.now()),
      KindDailyPlanner,
      sessionId,
      keepId,
    );
  }

  private disableExtraExamplesPlanners(sessionId: string, keepId: number): void {
    this.sql.exec(
      `UPDATE cron_job SET enabled = 0, running = 0, updated_at = ?
       WHERE enabled = 1 AND kind = ? AND session_id = ? AND id != ?`,
      formatCronTime(this.clock.now()),
      KindExamples,
      sessionId,
      keepId,
    );
  }

  private seedExamplesDay(prompt: string, spec: Spread, delivery: Delivery, zone: string): void {
    this.cancelExamplesPings(delivery.sessionId);
    const { times } = planSpreadTimes(spec, zone, this.clock.now());
    this.scheduleExamplesPings(prompt, delivery, zone, times);
  }

  /** Rewrites leftover per-mouth rows onto this store's session id. Runs on every open. */
  private collapseAgentScope(): void {
    const sid = this.sessionId;
    const now = formatCronTime(this.clock.now());
    this.sql.exec(
      `UPDATE cron_job SET session_id = ?, user_id = '', chat_id = '', thread_id = 0, updated_at = ?
       WHERE session_id != ? OR user_id != '' OR chat_id != '' OR thread_id != 0`,
      sid,
      now,
      sid,
    );
    const planner = this.findDailyPlanner(sid);
    if (planner) this.disableExtraPlanners(sid, planner.id);
    const examples = this.findExamples(sid);
    if (examples) this.disableExtraExamplesPlanners(sid, examples.id);
    this.collapsePrefs(sid);
  }

  private collapsePrefs(sid: string): void {
    const row = this.sql.one("SELECT session_id FROM session_pref ORDER BY updated_at DESC LIMIT 1");
    if (!row || typeof row.session_id !== "string") return;
    const src = row.session_id;
    if (src !== sid) {
      this.sql.exec("DELETE FROM session_pref WHERE session_id = ?", sid);
      this.sql.exec("UPDATE session_pref SET session_id = ? WHERE session_id = ?", sid, src);
    }
    this.sql.exec("DELETE FROM session_pref WHERE session_id != ?", sid);
  }
}

export function openStore(sql: Sql, clock: Clock, maxJobs = 50, sessionId = "agent"): Store {
  return new Store(sql, clock, maxJobs < 1 ? 50 : maxJobs, sessionId);
}

function jobFromRow(row: SqlRow): Job {
  const last = row.last_run_at;
  return {
    id: asNum(row.id),
    prompt: asStr(row.prompt),
    kind: asStr(row.kind),
    expr: asStr(row.expr),
    timezone: asStr(row.timezone),
    nextRunAt: parseCronTime(asStr(row.next_run_at)),
    sessionId: asStr(row.session_id),
    userId: asStr(row.user_id),
    chatId: asStr(row.chat_id),
    threadId: asNum(row.thread_id),
    enabled: asNum(row.enabled) !== 0,
    running: asNum(row.running) !== 0,
    createdAt: parseCronTime(asStr(row.created_at)),
    updatedAt: parseCronTime(asStr(row.updated_at)),
    lastRunAt: last == null || last === "" ? null : parseCronTime(asStr(last)),
    lastError: asStr(row.last_error),
    memoryId: row.memory_id == null ? 0 : asNum(row.memory_id),
    memorySubject: asStr(row.memory_subject),
  };
}

function errorMessage(err: unknown): string {
  if (err == null) return "";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") return `${err}`;
  return "unknown error";
}

function asNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  throw new Error("cron: expected number");
}

function asStr(v: SqlValue | undefined): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  throw new Error("cron: expected string");
}

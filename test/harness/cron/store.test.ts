import type { Sql } from "@/harness/core/sql";
import { KindDaily, KindDailyPlanner, KindEvery, KindOnce } from "@/harness/cron/constants";
import { DefaultDailyPlannerPrompt } from "@/harness/cron/prompts";
import { parsePlannerSchedule } from "@/harness/cron/schedule";
import { formatCronTime } from "@/harness/cron/time";
import { describe, expect, it } from "vitest";
import { countKind, openCron, reopen } from "./fixture";

describe("store", () => {
  it("records migration cron.001", () => {
    const { sql } = openCron();
    const ids = sql.exec<{ id: string }>("SELECT id FROM brain_migration").map((row) => row.id);
    expect(ids).toContain("cron.001");
  });

  it("claim succeeds when changes() overcounts (Durable Object index rows)", () => {
    const { sql: base, clock } = openCron();
    const sql: Sql = {
      exec: (...args) => base.exec(...args),
      one: (...args) => base.one(...args),
      changes: () => base.changes() * 2,
    };
    const store = reopen(sql, clock);
    const job = store.schedule("due now", {
      kind: KindOnce,
      expr: "x",
      timezone: "UTC",
      nextRun: clock.now() - 60_000,
    }, { sessionId: "s", userId: "u" });
    expect(store.claim(job.id, clock.now())).toBe(true);
    expect(store.get(job.id).running).toBe(true);
  });

  it("clears a stale running flag so a due job can fire", () => {
    const { store, clock } = openCron();
    const job = store.schedule("recover me", {
      kind: KindOnce,
      expr: "x",
      timezone: "UTC",
      nextRun: clock.now() - 60_000,
    }, { sessionId: "s", userId: "u" });
    store.sql.exec("UPDATE cron_job SET running = 1 WHERE id = ?", job.id);
    expect(store.due(clock.now(), 10)).toHaveLength(0);
    expect(store.clearStaleRunning()).toBe(1);
    const due = store.due(clock.now(), 10);
    expect(due.map((row) => row.id)).toEqual([job.id]);
  });

  it("does not resurrect a job cancelled after claim", () => {
    const { store, clock } = openCron();
    const job = store.schedule("daily dig", {
      kind: KindDaily,
      expr: "17:00",
      timezone: "UTC",
      nextRun: clock.now() - 60_000,
    }, { sessionId: "s", userId: "u" });
    expect(store.claim(job.id, clock.now())).toBe(true);
    store.cancel(job.id);
    store.finish(job, null);
    const got = store.get(job.id);
    expect(got.enabled).toBe(false);
    expect(got.running).toBe(false);
  });

  it("keeps a job disabled when enabled is cleared mid-flight", () => {
    const { store, clock } = openCron();
    const job = store.schedule("every hour", {
      kind: KindEvery,
      expr: "1h",
      timezone: "UTC",
      nextRun: clock.now() - 60_000,
    }, { sessionId: "s", userId: "u" });
    expect(store.claim(job.id, clock.now())).toBe(true);
    store.sql.exec("UPDATE cron_job SET enabled = 0 WHERE id = ?", job.id);
    store.finish(job, null);
    const got = store.get(job.id);
    expect(got.enabled).toBe(false);
    expect(got.running).toBe(false);
  });

  it("cancels the daily planner", () => {
    const { store, clock } = openCron();
    const delivery = { sessionId: "s", userId: "u", chatId: "1" };
    const parsed = parsePlannerSchedule("07:10", "UTC", clock.now());
    const { job } = store.ensureDailyPlanner(DefaultDailyPlannerPrompt, parsed, delivery);
    expect(job.kind).toBe(KindDailyPlanner);
    expect(job.expr).toBe("07:10");
    store.cancel(job.id);
    expect(store.findDailyPlanner(delivery.sessionId)).toBeNull();
  });

  it("orders due times with fixed-width nanos", () => {
    const { store } = openCron();
    const at = Date.UTC(2020, 0, 1, 10, 0, 0);
    const job = store.schedule("align", {
      kind: KindOnce,
      expr: "x",
      timezone: "UTC",
      nextRun: at,
    }, { sessionId: "s", userId: "u" });
    const due = store.due(at + 500, 10);
    expect(due.map((row) => row.id)).toEqual([job.id]);
    expect(formatCronTime(at) <= formatCronTime(at + 500)).toBe(true);
  });

  it("rewrites leftover mouth sessions onto the agent conversation", () => {
    const { sql, clock, store } = openCron();
    const job = store.schedule("leftover", {
      kind: KindOnce,
      expr: "x",
      timezone: "UTC",
      nextRun: clock.now() + 60 * 60_000,
    }, { sessionId: "telegram:1:1", userId: "1", chatId: "1" });
    expect(job.sessionId).toBe("telegram:1:1");
    expect(job.userId).toBe("");
    expect(job.chatId).toBe("");
    const again = reopen(sql, clock, 10);
    const got = again.get(job.id);
    expect(got.sessionId).toBe("agent");
    expect(got.userId).toBe("");
    expect(got.chatId).toBe("");
    expect(got.threadId).toBe(0);
    expect(countKind(again, KindOnce)).toBe(1);
  });
});

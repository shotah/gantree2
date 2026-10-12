import { KindDaily, KindDailyPlanner, KindExamplesPing, KindOnce, KindPreference, SilentToken, SubjectHours, ToolList, ToolSchedule } from "@/brain/cron/constants";
import { isDailyPlannerTurn } from "@/brain/cron/planner";
import { DefaultDailyPlannerPrompt } from "@/brain/cron/prompts";
import { Runner } from "@/brain/cron/runner";
import { onceParsed } from "@/brain/cron/spread";
import { CronTools } from "@/brain/cron/tools";
import type { PushMessage } from "@/brain/cron/types";
import { describe, expect, it } from "vitest";
import { fakeMemory, openCron, reopen } from "./fixture";

describe("runner", () => {
  it("fires a due once, pushes the reply, and disables the job", async () => {
    const { store, clock } = openCron(10);
    const past = clock.now() - 60_000;
    const job = store.schedule("submit timecard", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2", userId: "2", chatId: "1" });
    const pushes: PushMessage[] = [];
    let handled = "";
    const runner = new Runner({
      store,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      handled = turn.text;
      return "timecard reminder: do it now";
    });
    expect(handled.startsWith("[cron]")).toBe(true);
    expect(handled).toContain("call those tools first");
    expect(handled).toContain("submit timecard");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.id.startsWith("cron-")).toBe(true);
    expect(store.get(job.id).enabled).toBe(false);

    const toolsNow = clock.now();
    const tools = new CronTools({ store, zone: "UTC", now: () => toolsNow });
    await tools.call(ToolSchedule, { prompt: "hi", when: "in 1h" }, {
      sessionId: "telegram:1:2",
      userId: "2",
      chatId: "1",
    });
    const list = await tools.call(ToolList, {});
    expect(list).not.toBe("no cron jobs");
  });

  it("pushes photos the handler appended", async () => {
    const { store, clock } = openCron(10);
    const past = clock.now() - 60_000;
    store.schedule("draw the bike", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2" });
    const pushes: PushMessage[] = [];
    const runner = new Runner({
      store,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      turn.photos.push("data:image/png;base64,AQID");
      return "drew it";
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.photos[0]?.startsWith("data:image/png")).toBe(true);
  });

  it("does not push a silent reply and still finishes a once", async () => {
    const { store, clock } = openCron(10);
    const past = clock.now() - 60_000;
    const job = store.schedule("dead-man: check garmin, stay quiet if fine", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2", userId: "2", chatId: "1" });
    const pushes: PushMessage[] = [];
    let handled = "";
    const runner = new Runner({
      store,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      handled = turn.text;
      return `${SilentToken}\nall-clear`;
    });
    expect(handled).toContain("[silent]");
    expect(pushes).toHaveLength(0);
    expect(store.get(job.id).enabled).toBe(false);
  });

  it("lets the daily planner call tools", async () => {
    const { store, clock } = openCron(10);
    const past = clock.now() - 60_000;
    store.schedule(DefaultDailyPlannerPrompt, {
      kind: KindDailyPlanner,
      expr: "07:10",
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2", userId: "2", chatId: "1" });
    const pushes: PushMessage[] = [];
    let handled = "";
    let noTools = true;
    const runner = new Runner({
      store,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      noTools = turn.noTools;
      handled = turn.text;
      return SilentToken;
    });
    expect(noTools).toBe(false);
    expect(isDailyPlannerTurn(handled)).toBe(true);
    expect(handled).toContain("[aims]");
    expect(handled).toContain("Garmin");
    expect(pushes).toHaveLength(0);
  });

  it("is a no-op without a store, and fireDue replaces the old ticker", async () => {
    expect(new Runner().nextDue()).toBeNull();
    expect(await new Runner().fireDue(Date.now(), () => "ok")).toEqual([]);

    const { store, clock } = openCron(10);
    const past = clock.now() - 60_000;
    store.schedule("x", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "s", userId: "u", chatId: "1" });
    const pushes: PushMessage[] = [];
    const runner = new Runner({
      store,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    expect(runner.nextDue()).toBe(past);
    await runner.fireDue(clock.now(), () => "ok");
    expect(pushes).toHaveLength(1);
    expect(runner.nextDue()).toBeNull();
  });

  it("injects pinned memory and defers an examples ping during sleep", async () => {
    const { store, clock } = openCron(10, Date.UTC(2026, 6, 22, 12, 0, 0));
    const memory = fakeMemory();
    const row = memory.store("fact", "follow/passport", "Renew next month; offer to book.");
    const past = clock.now() - 60_000;
    store.scheduleWithPin("check the passport loop", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2", userId: "2", chatId: "1" }, row.id, row.subject);
    let handled = "";
    const runner = new Runner({
      store,
      memory,
      push: () => undefined,
    });
    await runner.fireDue(clock.now(), (turn) => {
      handled = turn.text;
      return "ok";
    });
    expect(handled).toContain("[job memory]");
    expect(handled).toContain("follow/passport");
    expect(handled).toContain("check the passport loop");

    memory.store(KindPreference, SubjectHours, "sleep: 00:00-23:59\nwork: 09:00-17:00\n");
    store.schedule(
      "an example",
      onceParsed(KindExamplesPing, clock.now() - 60_000, "UTC"),
      { sessionId: "telegram:1:9", userId: "9", chatId: "1" },
    );
    let exampleHandled = false;
    const sleepRunner = new Runner({
      store,
      memory,
      push: () => undefined,
    });
    await sleepRunner.fireDue(clock.now(), () => {
      exampleHandled = true;
      return SilentToken;
    });
    expect(exampleHandled).toBe(false);
  });

  it("walks a superseded pin and still runs when the row is gone", async () => {
    const { store, clock } = openCron(10);
    const memory = fakeMemory();
    const old = memory.store("fact", "follow/passport", "needs renewal — old note");
    const past = clock.now() - 60_000;
    store.scheduleWithPin("check the passport loop", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:3", userId: "3", chatId: "1" }, old.id, old.subject);
    memory.store("fact", "follow/passport", "booked the appointment");
    let handled = "";
    const runner = new Runner({ store, memory, push: () => undefined });
    await runner.fireDue(clock.now(), (turn) => {
      handled = turn.text;
      return "ok";
    });
    expect(handled).toContain("booked the appointment");
    expect(handled).not.toContain("old note");

    const gone = memory.store("fact", "follow/dentist", "call the office");
    store.scheduleWithPin("dentist follow-up", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:4", userId: "4", chatId: "1" }, gone.id, gone.subject);
    memory.forget(gone.id);
    handled = "";
    let ran = false;
    const missing = new Runner({ store, memory, push: () => undefined });
    await missing.fireDue(clock.now(), (turn) => {
      ran = true;
      handled = turn.text;
      return "ok";
    });
    expect(ran).toBe(true);
    expect(handled).not.toContain("[job memory]\n");
    expect(handled).not.toContain("call the office");
    expect(handled).toContain("dentist follow-up");
  });

  it("keeps a daily summary after the mouth session collapses", async () => {
    const { sql, clock, store } = openCron(10);
    const past = clock.now() - 60_000;
    const job = store.schedule("morning summary", {
      kind: KindDaily,
      expr: "07:00",
      nextRun: past,
      timezone: "America/Los_Angeles",
    }, { sessionId: "telegram:99:42", userId: "42", chatId: "99" });
    const again = reopen(sql, clock, 10);
    const got = again.get(job.id);
    expect(got.enabled).toBe(true);
    expect(got.kind).toBe(KindDaily);
    expect(got.sessionId).toBe("agent");
    expect(got.nextRunAt).toBeLessThanOrEqual(clock.now());

    const pushes: PushMessage[] = [];
    let text = "";
    let sessionId = "";
    const runner = new Runner({
      store: again,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      text = turn.text;
      sessionId = turn.sessionId;
      return "here's your morning summary";
    });
    expect(text).toContain("morning summary");
    expect(sessionId).toBe("agent");
    expect(pushes).toEqual([{
      text: "here's your morning summary",
      photos: [],
      id: pushes[0]?.id ?? "",
    }]);
    expect(pushes[0]?.id.startsWith("cron-")).toBe(true);
    expect(again.get(job.id).enabled).toBe(true);
  });

  it("keeps the daily planner after the mouth session collapses", async () => {
    const { sql, clock, store } = openCron(10);
    const past = clock.now() - 60_000;
    const job = store.schedule(DefaultDailyPlannerPrompt, {
      kind: KindDailyPlanner,
      expr: "07:10",
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2", userId: "2", chatId: "1" });
    const again = reopen(sql, clock, 10);
    const got = again.get(job.id);
    expect(got.enabled).toBe(true);
    expect(got.kind).toBe(KindDailyPlanner);
    expect(got.sessionId).toBe("agent");

    const pushes: PushMessage[] = [];
    let text = "";
    let sessionId = "";
    const runner = new Runner({
      store: again,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      text = turn.text;
      sessionId = turn.sessionId;
      return "aim check-in";
    });
    expect(isDailyPlannerTurn(text)).toBe(true);
    expect(sessionId).toBe("agent");
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.text).toBe("aim check-in");
    expect(pushes[0]?.photos).toEqual([]);
  });

  it("pushes text only and keeps the pre-collapse session on the turn", async () => {
    const { store, clock } = openCron(10);
    const past = clock.now() - 60_000;
    store.schedule("telegram leftover", {
      kind: KindOnce,
      expr: new Date(past).toISOString(),
      nextRun: past,
      timezone: "UTC",
    }, { sessionId: "telegram:1:2", userId: "2", chatId: "1" });
    const pushes: PushMessage[] = [];
    let handled = false;
    const runner = new Runner({
      store,
      push: (msg) => {
        pushes.push(msg);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      handled = true;
      expect(turn.sessionId).toBe("telegram:1:2");
      return "hello";
    });
    expect(handled).toBe(true);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.text).toBe("hello");
    expect(pushes[0]?.id.startsWith("cron-")).toBe(true);
    expect(Object.keys(pushes[0] ?? {}).sort()).toEqual(["id", "photos", "text"]);
  });
});

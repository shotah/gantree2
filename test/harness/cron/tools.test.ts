import { KindOnce, ToolCancel, ToolList, ToolSchedule } from "@/harness/cron/constants";
import { Composite } from "@/harness/cron/composite";
import { cronToolDefs, CronTools, isCronTool } from "@/harness/cron/tools";
import { describe, expect, it } from "vitest";
import { fakeMemory, openCron } from "./fixture";

describe("cron tools", () => {
  it("publishes schedule, list, and cancel", () => {
    const defs = cronToolDefs();
    expect(defs).toHaveLength(3);
    const names = new Set(defs.map((def) => def.name));
    for (const name of [ToolSchedule, ToolList, ToolCancel]) {
      expect(names.has(name)).toBe(true);
      expect(isCronTool(name)).toBe(true);
    }
    expect(isCronTool("nope")).toBe(false);
  });

  it("schedules, lists, and cancels", async () => {
    const { store } = openCron(5);
    expect(store.maxJobs).toBe(5);
    const tools = new CronTools({ store, zone: "UTC" });
    const delivery = { sessionId: "stdio", userId: "local", chatId: "1" };
    const out = await tools.call(ToolSchedule, { prompt: "ping", when: "in 1h" }, delivery);
    expect(out).not.toBe("");
    const list = await tools.call(ToolList, {});
    expect(list).not.toBe("no cron jobs");
    expect(list).toContain("kind=once");
    expect(list).toContain("prompt=\"ping\"");
    const jobs = store.list(false);
    expect(jobs).toHaveLength(1);
    const id = jobs[0]?.id ?? 0;
    await tools.call(ToolCancel, { id: String(id) });
    expect(() => store.cancel(99999)).toThrow(/not found/);
  });

  it("resolves a clock time against the injected now", async () => {
    const { store } = openCron(5);
    const frozen = Date.UTC(2026, 9, 7, 8, 0, 0);
    const tools = new CronTools({ store, zone: "UTC", now: () => frozen });
    await tools.call(ToolSchedule, {
      prompt: "passport",
      when: "11:00",
      memory_subject: "todo/passport",
    }, { sessionId: "stdio", userId: "local", chatId: "1" });
    const jobs = store.listSession("stdio", false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.nextRunAt).toBe(frozen + 3 * 60 * 60_000);
    expect(jobs[0]?.memorySubject).toBe("todo/passport");
  });

  it("pins a memory row and rejects a missing id", async () => {
    const { store } = openCron(5);
    const memory = fakeMemory();
    const row = memory.store("fact", "follow/passport", "renew next month");
    const tools = new CronTools({ store, zone: "UTC", memory });
    const delivery = { sessionId: "stdio", userId: "local", chatId: "1" };
    const out = await tools.call(ToolSchedule, {
      prompt: "check passport",
      when: "in 1h",
      memory_id: row.id,
    }, delivery);
    expect(out).toContain(`memory_id=${row.id}`);
    expect(out).toContain("follow/passport");
    const list = await tools.call(ToolList, {});
    expect(list).toContain("follow/passport");
    await expect(tools.call(ToolSchedule, {
      prompt: "x",
      when: "in 1h",
      memory_id: 99999,
    }, delivery)).rejects.toThrow(/memory_id 99999 not found/);
  });

  it("routes cron names to cron and everything else to the other runner", async () => {
    const { store } = openCron(10);
    let calls = 0;
    const other = {
      tools: () => [{ name: "x__y", description: "x", inputSchema: { type: "object" } }],
      call: () => {
        calls += 1;
        return "ok";
      },
    };
    const composite = new Composite(new CronTools({ store, zone: "UTC" }), other);
    expect(composite.toolCount()).toBeGreaterThanOrEqual(4);
    await composite.call(ToolList, null, { sessionId: "s", userId: "u" });
    await composite.call("x__y", null);
    expect(calls).toBe(1);
  });

  it("lists and cancels across sessions", async () => {
    const { store } = openCron(5);
    const tools = new CronTools({ store, zone: "UTC" });
    await tools.call(ToolSchedule, { prompt: "from-a", when: "in 1h" }, { sessionId: "a" });
    await tools.call(ToolSchedule, { prompt: "from-b", when: "in 2h" }, { sessionId: "b" });
    const list = await tools.call(ToolList, {}, { sessionId: "a" });
    expect(list).toContain("from-a");
    expect(list).toContain("from-b");
    expect(list).not.toContain("session=");
    const jobs = store.list(false);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.kind).toBe(KindOnce);
    await tools.call(ToolCancel, { id: jobs[0]?.id ?? 0 }, { sessionId: "a" });
  });
});

import { describe, expect, it } from "vitest";
import { createBrain } from "@/harness/agent";
import { KIND_EPISODE } from "@/harness/memory";
import { MemoryStore } from "@/harness/memory/store";
import { makeLogger, memorySink } from "@/harness/core/log";
import { collect, freshSql, scriptResult, Scripted, testDeps } from "./fixture";

describe("consolidation idle alarm", () => {
  it("nextAlarm is null when consolidation is caught up and nothing else is due", async () => {
    const sql = freshSql();
    const deps = testDeps({
      sql,
      provider: new Scripted([
        scriptResult({ content: "[]", toolCalls: [] }),
      ]),
      env: {
        MEMORY_CONSOLIDATE_MINUTES: "30",
        EXAMPLES_QTY: "0",
        DAILY_PLANNER_AT: "0",
      },
    });
    const memory = new MemoryStore(sql, deps.clock, makeLogger(memorySink(), () => deps.clock.now()));
    memory.store(KIND_EPISODE, "ada", "already consolidated path");
    const brain = createBrain(deps);
    const { emit } = collect();
    await brain.handleInbound({ kind: "inbound", user_id: "u1", id: "m0", text: "/planner off" }, emit);
    const interval = 30 * 60_000;
    expect(brain.nextAlarm()).toBe(deps.clock.now() + interval);

    await brain.alarm(emit);
    expect(brain.nextAlarm()).toBeNull();
  });
});

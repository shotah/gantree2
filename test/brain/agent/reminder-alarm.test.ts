import { describe, expect, it } from "vitest";
import { createBrain } from "@/brain/agent";
import { fixedClock } from "@/brain/core/clock";
import { collect, freshSql, scriptResult, Scripted, testDeps } from "./fixture";

describe("cron reminder alarm", () => {
  it("wakes a cold brain and pushes at the scheduled time", async () => {
    const clock = fixedClock(Date.parse("2026-09-14T19:00:00Z"), "America/Los_Angeles");
    const sql = freshSql();
    const scheduleProvider = new Scripted([
      scriptResult({
        content: "",
        toolCalls: [{
          id: "c1",
          name: "cron_schedule",
          arguments: JSON.stringify({
            prompt: "Remind them to submit the timecard",
            when: "in 5m",
            repeat: "once",
          }),
        }],
      }),
      scriptResult({ content: "On it — I'll ping you in five minutes.", toolCalls: [] }),
    ]);
    const brainA = createBrain(testDeps({ sql, clock, provider: scheduleProvider }));
    const { emit } = collect();
    await brainA.handleInbound(
      { kind: "inbound", user_id: "u1", id: "m1", text: "Ping me in five to submit my timecard." },
      emit,
    );
    const nowAfterTurn = clock.now();
    const due = brainA.nextAlarm();
    expect(due).toBe(nowAfterTurn + 5 * 60_000);
    if (due == null) throw new Error("missing reminder alarm");
    clock.set(due);

    const alarmProvider = new Scripted([
      scriptResult({ content: "Submit the timecard.", toolCalls: [] }),
    ]);
    const brainB = createBrain(testDeps({ sql, clock, provider: alarmProvider }));
    const { emit: alarmEmit, frames } = collect();
    await brainB.alarm(alarmEmit);
    const push = frames.find((frame) => frame.kind === "push");
    expect(push).toMatchObject({ kind: "push", text: "Submit the timecard." });
  });
});

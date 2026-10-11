import { KindDaily, KindDailyPlanner, KindEvery, KindExamplesPing, KindOnce } from "@/brain/cron/constants";
import { atZone } from "@/brain/cron/time";
import type { Job } from "@/brain/cron/types";
import { formatWakes } from "@/brain/cron/wakes";
import { describe, expect, it } from "vitest";

function wake(partial: Pick<Job, "kind" | "enabled" | "nextRunAt" | "prompt">): Job {
  return {
    id: 0,
    expr: "",
    timezone: "America/Los_Angeles",
    sessionId: "",
    userId: "",
    chatId: "",
    threadId: 0,
    running: false,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    lastError: "",
    memoryId: 0,
    memorySubject: "",
    ...partial,
  };
}

describe("formatWakes", () => {
  it("lists the next three human jobs, soonest first", () => {
    const zone = "America/Los_Angeles";
    const now = atZone(2026, 9, 14, 12, 2, 0, zone);
    const hour = 60 * 60_000;
    const jobs = [
      wake({ kind: KindDaily, enabled: true, nextRunAt: now + 44 * hour, prompt: "Morning digest" }),
      wake({ kind: KindOnce, enabled: true, nextRunAt: now + 5 * hour, prompt: "  Remind them to   leave for the gym  " }),
      wake({ kind: KindDailyPlanner, enabled: true, nextRunAt: now + hour, prompt: "[cron] Daily planner" }),
      wake({ kind: KindOnce, enabled: false, nextRunAt: now + 2 * hour, prompt: "cancelled" }),
      wake({ kind: KindEvery, enabled: true, nextRunAt: now + 9 * 24 * hour, prompt: "Water the plants and check the balcony tomatoes" }),
      wake({ kind: KindOnce, enabled: true, nextRunAt: now + 10 * 24 * hour, prompt: "fourth" }),
    ];
    const want = "[wakes] 5:02 PM Remind them to leave for the gym · Wed 8:02 AM Morning digest · Sep 23 12:02 PM Water the plants and check the balcony… (+1 more — cron_list)";
    expect(formatWakes(jobs, now, zone)).toBe(want);
  });

  it("is empty without human jobs", () => {
    const now = Date.UTC(2026, 8, 14, 19, 2, 0);
    expect(formatWakes([], now, "UTC")).toBe("");
    const only = [wake({ kind: KindExamplesPing, enabled: true, nextRunAt: now + 60 * 60_000, prompt: "x" })];
    expect(formatWakes(only, now, "UTC")).toBe("");
  });
});

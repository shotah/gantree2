import { DailyPlannerPrefix, DefaultDailyPlannerPrompt, JobUserPrefix } from "@/harness/cron/prompts";
import { advanceNext, nextPlannerAt, parsePlannerAt, parseSchedule } from "@/harness/cron/schedule";
import { isDailyPlannerTurn } from "@/harness/cron/planner";
import { KindDailyPlanner } from "@/harness/cron/constants";
import { describe, expect, it } from "vitest";

describe("parsePlannerAt", () => {
  it("accepts clock times and rejects windows", () => {
    expect(parsePlannerAt("07:10")).toEqual({ hour: 7, minute: 10 });
    expect(parsePlannerAt("9:30pm")).toEqual({ hour: 21, minute: 30 });
    expect(parsePlannerAt("9am")).toEqual({ hour: 9, minute: 0 });
    expect(() => parsePlannerAt("4-6")).toThrow();
    expect(() => parsePlannerAt("4-6@06-21")).toThrow();
  });
});

describe("nextPlannerAt", () => {
  it("fires once per civil day, including a clock move mid-session", () => {
    const before = Date.UTC(2026, 6, 29, 6, 0, 0);
    expect(nextPlannerAt(7, 10, "UTC", before, null, false)).toBe(Date.UTC(2026, 6, 29, 7, 10, 0));
    const after = Date.UTC(2026, 6, 29, 8, 0, 0);
    expect(nextPlannerAt(7, 10, "UTC", after, null, false)).toBe(Date.UTC(2026, 6, 30, 7, 10, 0));
    const running = Date.UTC(2026, 6, 29, 7, 15, 0);
    expect(nextPlannerAt(11, 0, "UTC", running, null, true)).toBe(Date.UTC(2026, 6, 30, 11, 0, 0));
  });
});

describe("advanceNext daily planner", () => {
  it("steps to the next morning and leaves the expression alone", () => {
    const from = Date.UTC(2026, 6, 29, 7, 10, 0);
    const next = advanceNext(KindDailyPlanner, "07:10", "UTC", from);
    expect(next.ok).toBe(true);
    expect(next.newExpr).toBe("");
    expect(next.next).toBe(Date.UTC(2026, 6, 30, 7, 10, 0));
  });
});

describe("parseSchedule planner", () => {
  it("treats repeat=planner as the daily session", () => {
    const now = Date.UTC(2026, 6, 29, 8, 0, 0);
    const parsed = parseSchedule("09:30", "planner", "UTC", now);
    expect(parsed.kind).toBe(KindDailyPlanner);
    expect(parsed.expr).toBe("09:30");
    expect(parsed.nextRun).toBe(Date.UTC(2026, 6, 29, 9, 30, 0));
  });
});

describe("daily planner prompt", () => {
  it("is one session and is marked as the planner turn", () => {
    const body = DailyPlannerPrefix + DefaultDailyPlannerPrompt;
    for (const needle of [
      "one planning session",
      "Garmin",
      "calendar",
      "mail",
      "[silent]",
      "vacation",
      "repeat=planner",
      "[aims]",
      "[wait]",
      "agree-and-stop",
      "aim_log",
      "aim_history",
      "[progress]",
      "praised",
      "note=asked",
      "note=quiet",
      "weeks:",
      "slope",
      "r=",
      "[todo]",
      "memory_subject todo/<slug>",
      "never an offer to drop it",
      "[todo] is in priority order",
      "do it now",
      "no closer",
      "[silent] stays [silent]",
    ]) {
      expect(body, needle).toContain(needle);
    }
    expect(isDailyPlannerTurn(body)).toBe(true);
    expect(isDailyPlannerTurn(`${JobUserPrefix}Fetch Garmin sleep`)).toBe(false);
  });
});

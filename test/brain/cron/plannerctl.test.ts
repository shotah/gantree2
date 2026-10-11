import { localParts } from "@/brain/core/clock";
import { AgentSession, KindDailyPlanner, PlannerOff } from "@/brain/cron/constants";
import { PlannerService } from "@/brain/cron/planner";
import { DefaultDailyPlannerPrompt } from "@/brain/cron/prompts";
import { parsePlannerSchedule } from "@/brain/cron/schedule";
import { describe, expect, it } from "vitest";
import { openCron } from "./fixture";

describe("planner service", () => {
  it("inherits the operator clock and opts out", () => {
    const { store } = openCron();
    const svc = new PlannerService({ store, zone: "UTC", at: "07:10" });
    const delivery = { sessionId: AgentSession };
    expect(svc.resolvedAt(delivery.sessionId)).toBe("07:10");
    svc.setAt(delivery.sessionId, "9:30am");
    const ensured = svc.ensureFor(delivery);
    expect(ensured.job?.id).toBeGreaterThan(0);
    expect(ensured.job?.expr).toBe("09:30");
    expect(ensured.job?.kind).toBe(KindDailyPlanner);
    expect(() => svc.setAt(delivery.sessionId, "3-5")).toThrow();
    svc.setAt(delivery.sessionId, PlannerOff);
    const off = svc.ensureFor(delivery);
    expect(off.job).toBeNull();
    expect(store.findDailyPlanner(delivery.sessionId)).toBeNull();
  });

  it("keeps a single daily planner job", () => {
    const { store, clock } = openCron();
    const parsed = parsePlannerSchedule("07:10", "UTC", clock.now());
    const delivery = { sessionId: AgentSession };
    const first = store.ensureDailyPlanner(DefaultDailyPlannerPrompt, parsed, delivery);
    expect(first.created).toBe(true);
    const second = store.ensureDailyPlanner(DefaultDailyPlannerPrompt, parsed, delivery);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    const jobs = store.list(false);
    expect(jobs.every((job) => job.kind === KindDailyPlanner)).toBe(true);
    expect(jobs.filter((job) => job.kind === KindDailyPlanner)).toHaveLength(1);
  });

  it("keeps a clock moved during the run", () => {
    const { store, clock } = openCron();
    const past = clock.now() - 60_000;
    const delivery = { sessionId: AgentSession };
    const job = store.schedule(DefaultDailyPlannerPrompt, {
      kind: KindDailyPlanner,
      expr: "07:10",
      nextRun: past,
      timezone: "UTC",
    }, delivery);
    expect(store.claim(job.id, clock.now())).toBe(true);
    const moved = parsePlannerSchedule("11:00", "UTC", clock.now());
    store.ensureDailyPlanner(DefaultDailyPlannerPrompt, moved, delivery);
    store.finish(job, null);
    const got = store.get(job.id);
    expect(got.running).toBe(false);
    expect(got.expr).toBe("11:00");
    expect(localParts(got.nextRunAt, "UTC").hour).toBe(11);
  });
});

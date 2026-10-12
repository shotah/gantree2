import { KindExamples, KindExamplesPing } from "@/harness/cron/constants";
import { Runner } from "@/harness/cron/runner";
import { onceParsed, parseSpreadSchedule } from "@/harness/cron/spread";
import { describe, expect, it } from "vitest";
import { countKind, openCron } from "./fixture";

describe("examples jobs", () => {
  it("does not reseed pings when the planner is already aimed at tomorrow", () => {
    const { store, clock } = openCron(50, Date.UTC(2026, 6, 22, 12, 0, 0));
    const parsed = parseSpreadSchedule(KindExamples, "2-2@00-24", 0, 24, "UTC", clock.now());
    const delivery = { sessionId: "telegram:11:11", userId: "11", chatId: "11" };
    const first = store.ensureExamples("examples prompt", parsed, delivery);
    expect(first.created).toBe(true);
    const seeded = countKind(store, KindExamplesPing);
    expect(seeded).toBeGreaterThanOrEqual(1);
    expect(store.cancelExamplesPings(delivery.sessionId)).toBeGreaterThanOrEqual(1);
    const second = store.ensureExamples("examples prompt", parsed, delivery);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(countKind(store, KindExamplesPing)).toBe(0);
  });

  it("keeps an opt-out across a later ensure", () => {
    const { store, clock } = openCron();
    const delivery = { sessionId: "telegram:12:12", userId: "12", chatId: "12" };
    expect(store.examplesEnabled(delivery.sessionId)).toBe(true);
    const parsed = parseSpreadSchedule(KindExamples, "1-1@00-24", 0, 24, "UTC", clock.now());
    store.ensureExamples("p", parsed, delivery);
    expect(countKind(store, KindExamples)).toBe(1);
    store.setExamplesEnabled(delivery.sessionId, false);
    expect(store.cancelExamplesPlannerAndPings(delivery.sessionId)).toBeGreaterThanOrEqual(1);
    expect(store.examplesEnabled(delivery.sessionId)).toBe(false);
    expect(countKind(store, KindExamples)).toBe(0);
    store.setExamplesEnabled(delivery.sessionId, true);
    store.ensureExamples("p", parsed, delivery);
    expect(countKind(store, KindExamples)).toBe(1);
  });

  it("runs an examples ping with no tools and a live prompt", async () => {
    const { store, clock } = openCron();
    const past = clock.now() - 60_000;
    store.schedule(
      "placeholder",
      onceParsed(KindExamplesPing, past, "UTC"),
      { sessionId: "telegram:13:13", userId: "13", chatId: "13" },
    );
    let noTools = false;
    let prompt = "";
    const runner = new Runner({
      store,
      examples: () => "polish this seed",
      push: () => undefined,
    });
    await runner.fireDue(clock.now(), (turn) => {
      noTools = turn.noTools;
      prompt = turn.text;
      return "try this calendar idea";
    });
    expect(noTools).toBe(true);
    expect(prompt.startsWith("[cron]")).toBe(true);
    expect(prompt).toContain("polish this seed");
  });
});

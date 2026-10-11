import { ExamplesService } from "@/brain/examples/service";
import { describe, expect, it } from "vitest";
import { openCron } from "../cron/fixture";

describe("examples service", () => {
  it("respects proactive config and a session opt-out", () => {
    const { store } = openCron();
    const svc = new ExamplesService({
      store,
      qty: "1-1",
      startHour: 0,
      endHour: 24,
      zone: "UTC",
      tools: () => [{ name: "google__calendar_list_events" }],
    });
    expect(svc.proactiveEnabled()).toBe(true);
    expect(new ExamplesService({ store: null, qty: "0", startHour: 0, endHour: 24, zone: "UTC" }).proactiveEnabled()).toBe(false);
    expect(new ExamplesService({ store: null, qty: "", startHour: 0, endHour: 24, zone: "UTC" }).proactiveEnabled()).toBe(false);

    const delivery = { sessionId: "telegram:99:99", userId: "99", chatId: "99" };
    const first = svc.ensureFor(delivery);
    expect(first.created).toBe(true);
    expect(first.job?.id).toBeGreaterThan(0);

    const suggested = svc.suggestPrompt();
    expect(suggested?.prompt).toBeTruthy();
    expect(suggested?.seed.id).toBeTruthy();

    svc.setEnabled(delivery.sessionId, false);
    expect(svc.ensureFor(delivery).job).toBeNull();

    svc.setEnabled(delivery.sessionId, true);
    const restored = svc.ensureFor(delivery);
    expect(restored.job?.id).toBeGreaterThan(0);
  });
});

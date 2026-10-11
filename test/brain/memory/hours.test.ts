import { describe, expect, it } from "vitest";
import { parseHours } from "@/brain/memory";

describe("hours", () => {
  it("parses sleep and work and treats the end minute as awake", () => {
    const h = parseHours("sleep: 23:00-07:00\nwork: 09:00-17:00\nquiet: (none)\n");
    expect(h.known()).toBe(true);
    expect(h.sleepStart).toBe(23 * 60);
    expect(h.sleepEnd).toBe(7 * 60);
    expect(h.workStart).toBe(9 * 60);
    expect(h.workEnd).toBe(17 * 60);
    const asleep = Date.parse("2026-08-25T02:00:00Z");
    const awake = Date.parse("2026-08-25T11:00:00Z");
    const edge = Date.parse("2026-08-25T07:00:00Z");
    expect(h.asleepAt(asleep, "UTC")).toBe(true);
    expect(h.asleepAt(awake, "UTC")).toBe(false);
    expect(h.asleepAt(edge, "UTC")).toBe(false);
    const unknown = parseHours("");
    expect(unknown.known()).toBe(false);
    expect(unknown.asleepAt(asleep, "UTC")).toBe(false);
    expect(unknown.footer()).toContain("unknown");
    expect(h.footer()).toContain("sleep 23:00-07:00");
    expect(h.footer()).toContain("work 09:00-17:00");
  });
});

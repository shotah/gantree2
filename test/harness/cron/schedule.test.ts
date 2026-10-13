import { localParts } from "@/harness/core/clock";
import { advanceNext, parseSchedule } from "@/harness/cron/schedule";
import { atZone } from "@/harness/cron/time";
import { KindDaily, KindEvery, KindOnce } from "@/harness/cron/constants";
import { describe, expect, it } from "vitest";

const LA = "America/Los_Angeles";

describe("parseSchedule", () => {
  it("parses relative, daily, and every", () => {
    const now = Date.UTC(2026, 6, 22, 12, 0, 0);
    const relative = parseSchedule("in 30m", "once", "UTC", now);
    expect(relative.kind).toBe(KindOnce);
    expect(relative.nextRun).toBe(now + 30 * 60_000);

    const daily = parseSchedule("17:00", "daily", "UTC", now);
    expect(daily.kind).toBe(KindDaily);
    expect(daily.expr).toBe("17:00");
    expect(localParts(daily.nextRun, "UTC").hour).toBe(17);

    const every = parseSchedule("every:1h", "", "UTC", now);
    expect(every.kind).toBe(KindEvery);
  });

  it("parses same-day wall clocks including 4pm and 4:00 PM", () => {
    const now = atZone(2026, 9, 12, 15, 0, 0, LA);
    const expectFourPm = (when: string) => {
      const parsed = parseSchedule(when, "once", LA, now);
      expect(parsed.kind).toBe(KindOnce);
      const parts = localParts(parsed.nextRun, LA);
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(9);
      expect(parts.day).toBe(12);
      expect(parts.hour).toBe(16);
      expect(parts.minute).toBe(0);
    };
    expectFourPm("4pm");
    expectFourPm("4:00 PM");
    expectFourPm("16:00");
  });

  it("rolls a passed wall clock to tomorrow", () => {
    const now = atZone(2026, 9, 12, 16, 30, 0, LA);
    const parsed = parseSchedule("4pm", "once", LA, now);
    const parts = localParts(parsed.nextRun, LA);
    expect(parts.day).toBe(13);
    expect(parts.hour).toBe(16);
  });

  it("parses 12am as midnight", () => {
    const now = atZone(2026, 9, 12, 15, 0, 0, LA);
    const parsed = parseSchedule("12am", "once", LA, now);
    const parts = localParts(parsed.nextRun, LA);
    expect(parts.day).toBe(13);
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
  });

  it("rejects unparseable when strings", () => {
    const now = atZone(2026, 9, 12, 15, 0, 0, LA);
    expect(() => parseSchedule("tomorrow", "once", LA, now)).toThrow(/cannot parse when/);
  });
});

describe("advanceNext", () => {
  it("does not repeat once, and steps daily by a civil day", () => {
    const from = Date.UTC(2026, 6, 22, 17, 0, 0);
    expect(advanceNext(KindOnce, new Date(from).toISOString(), "UTC", from).ok).toBe(false);

    const daily = advanceNext(KindDaily, "17:00", "UTC", from);
    expect(daily.ok).toBe(true);
    expect(localParts(daily.next, "UTC").day).toBe(23);

    const la = advanceNext(KindDaily, "09:00", "America/Los_Angeles", from);
    expect(la.ok).toBe(true);
    expect(localParts(la.next, "America/Los_Angeles").hour).toBe(9);
    expect(() => advanceNext(KindDaily, "09:00", "Not/AZone", from)).toThrow(/timezone/);
  });

  it("keeps the wall hour across the US spring-forward", () => {
    const from = atZone(2026, 3, 8, 6, 0, 0, "America/Los_Angeles");
    const next = advanceNext(KindDaily, "06:00", "America/Los_Angeles", from);
    expect(next.ok).toBe(true);
    const got = localParts(next.next, "America/Los_Angeles");
    expect(got.day).toBe(9);
    expect(got.hour).toBe(6);
  });
});

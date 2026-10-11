import { localParts } from "@/brain/core/clock";
import { advanceNext, parseSchedule } from "@/brain/cron/schedule";
import { atZone } from "@/brain/cron/time";
import { KindDaily, KindEvery, KindOnce } from "@/brain/cron/constants";
import { describe, expect, it } from "vitest";

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

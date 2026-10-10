import { describe, expect, it } from "vitest";
import { relativeTime, timeStamp } from "@/app/components/agents/relativeTime";

const NOW = 1_700_000_000_000;

describe("relativeTime", () => {
  it("ages a timestamp in seconds, minutes, hours, and days", () => {
    expect(relativeTime(null, NOW)).toBe("—");
    expect(relativeTime(Number.NaN, NOW)).toBe("—");
    expect(relativeTime(Number.POSITIVE_INFINITY, NOW)).toBe("—");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("0s ago");
    expect(relativeTime(NOW, NOW)).toBe("0s ago");
    expect(relativeTime(NOW - 44_000, NOW)).toBe("44s ago");
    expect(relativeTime(NOW - 45_000, NOW)).toBe("1m ago");
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe("59m ago");
    expect(relativeTime(NOW - 60 * 60_000, NOW)).toBe("1h ago");
    expect(relativeTime(NOW - 47 * 3_600_000, NOW)).toBe("47h ago");
    expect(relativeTime(NOW - 48 * 3_600_000, NOW)).toBe("2d ago");
  });

  it("formats a finite stamp and skips the rest", () => {
    expect(timeStamp(null)).toBeUndefined();
    expect(timeStamp(Number.NaN)).toBeUndefined();
    expect(timeStamp(NOW)).toBe(new Date(NOW).toISOString());
  });
});

import { describe, expect, it } from "vitest";
import { idleClock, idleHoursOf, USER_IDLE_MS } from "@/lib/agents/idle";

describe("idleClock", () => {
  it("does not stop on a fresh anchor and wakes at now + 48h", () => {
    const now = 1_000_000;
    const out = idleClock(null, now, now);
    expect(out.stop).toBe(false);
    expect(out.wakeAt).toBe(now + USER_IDLE_MS);
  });

  it("does not stop when the last human message was 47h ago", () => {
    const now = 200_000_000_000;
    const lastUserAt = now - 47 * 60 * 60 * 1000;
    const out = idleClock(lastUserAt, 0, now);
    expect(out.stop).toBe(false);
    expect(out.wakeAt).toBe(lastUserAt + USER_IDLE_MS);
  });

  it("stops at exactly 48h since the later of anchor and last user", () => {
    const anchor = 5_000;
    const lastUserAt = 1_000;
    const since = Math.max(lastUserAt, anchor);
    const now = since + USER_IDLE_MS;
    expect(idleClock(lastUserAt, anchor, now).stop).toBe(true);
  });

  it("stops after 49h", () => {
    const lastUserAt = 100;
    const now = lastUserAt + 49 * 60 * 60 * 1000;
    expect(idleClock(lastUserAt, 0, now).stop).toBe(true);
  });

  it("stops after a 1-hour window when configured", () => {
    const oneHour = 60 * 60 * 1000;
    const lastUserAt = 500;
    const now = lastUserAt + oneHour;
    expect(idleClock(lastUserAt, 0, now, oneHour).stop).toBe(true);
    expect(idleClock(lastUserAt, 0, lastUserAt + oneHour - 1, oneHour).stop).toBe(false);
  });

  it("does not stop at 48h when the window is 72h", () => {
    const seventyTwo = 72 * 60 * 60 * 1000;
    const lastUserAt = 1_000;
    const now = lastUserAt + USER_IDLE_MS;
    expect(idleClock(lastUserAt, 0, now, seventyTwo).stop).toBe(false);
  });

  it("idleHoursOf falls back for null and invalid stored values", () => {
    expect(idleHoursOf(null)).toBe(48);
    expect(idleHoursOf(undefined)).toBe(48);
    expect(idleHoursOf(0)).toBe(48);
    expect(idleHoursOf(8761)).toBe(48);
    expect(idleHoursOf(2)).toBe(2);
  });

  it("uses a newer re-enable anchor over an older lastUserAt", () => {
    const lastUserAt = 1_000;
    const anchorMs = 2_000;
    const now = anchorMs + USER_IDLE_MS - 1;
    const out = idleClock(lastUserAt, anchorMs, now);
    expect(out.stop).toBe(false);
    expect(out.wakeAt).toBe(anchorMs + USER_IDLE_MS);
  });
});

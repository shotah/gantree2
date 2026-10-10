import { describe, expect, it } from "vitest";
import { FRAME_BYTES_MAX, RATE_BYTES_BURST, RATE_BYTES_PER_MIN, RATE_FRAMES_PER_MIN } from "@/lib/chat/caps";
import { principalKey, pruneDualLimits, takeFrame, takeTokens } from "@/lib/chat/rate";

describe("rate", () => {
  it("allows a burst then 429s", () => {
    let bucket = takeTokens(undefined, 0, 1, { rate: 2, burst: 2 });
    expect(bucket.ok).toBe(true);
    bucket = takeTokens(bucket.bucket, 0, 1, { rate: 2, burst: 2 });
    expect(bucket.ok).toBe(true);
    bucket = takeTokens(bucket.bucket, 0, 1, { rate: 2, burst: 2 });
    expect(bucket.ok).toBe(false);
  });

  it("refills over a minute", () => {
    let bucket = takeTokens(undefined, 0, 2, { rate: 2, burst: 2 });
    expect(bucket.ok).toBe(true);
    bucket = takeTokens(bucket.bucket, 60_000, 2, { rate: 2, burst: 2 });
    expect(bucket.ok).toBe(true);
  });

  it("caps frames and bytes together", () => {
    let limits = takeFrame(undefined, 0, 10);
    expect(limits.ok).toBe(true);
    for (let i = 0; i < RATE_FRAMES_PER_MIN; i++) {
      limits = takeFrame(limits.limits, 0, 1);
    }
    expect(limits.ok).toBe(false);
    const fat = takeFrame(undefined, 0, RATE_BYTES_BURST + 1);
    expect(fat.ok).toBe(false);
    expect(principalKey("sub", "abc")).toBe("sub:abc");
  });

  it("lets two full photo frames through back to back, then refills at the sustained rate", () => {
    expect(RATE_BYTES_BURST).toBeGreaterThanOrEqual(2 * FRAME_BYTES_MAX);
    let limits = takeFrame(undefined, 0, FRAME_BYTES_MAX);
    expect(limits.ok).toBe(true);
    limits = takeFrame(limits.limits, 0, FRAME_BYTES_MAX);
    expect(limits.ok).toBe(true);
    const third = takeFrame(limits.limits, 0, FRAME_BYTES_MAX);
    expect(third.ok).toBe(false);
    const text = takeFrame(third.limits, 1_000, 200);
    expect(text.ok).toBe(true);
    const laterPhoto = takeFrame(text.limits, 60_000 * Math.ceil(FRAME_BYTES_MAX / RATE_BYTES_PER_MIN), FRAME_BYTES_MAX);
    expect(laterPhoto.ok).toBe(true);
  });

  it("drops idle dual-limit rows", () => {
    const now = 10_000;
    const all = {
      stale: { frames: { tokens: 1, updated: 0 }, bytes: { tokens: 1, updated: 0 } },
      live: { frames: { tokens: 1, updated: now }, bytes: { tokens: 1, updated: now } },
    };
    expect(Object.keys(pruneDualLimits(all, now + 60_000))).toEqual(["live"]);
  });
});

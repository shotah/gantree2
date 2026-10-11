import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVAL_SEC, parseInterval } from "@/brain/watch";

describe("parseInterval", () => {
  it("accepts empty, Go durations, and integer seconds", () => {
    expect(parseInterval("")).toBe(DEFAULT_INTERVAL_SEC);
    expect(parseInterval("15m")).toBe(15 * 60);
    expect(parseInterval("1h")).toBe(60 * 60);
    expect(parseInterval("900")).toBe(15 * 60);
  });

  it("rejects too short, zero, junk, and anything past a week", () => {
    expect(() => parseInterval("30s")).toThrow(/1m0s/);
    expect(() => parseInterval("0")).toThrow(/positive/);
    expect(() => parseInterval("nope")).toThrow(/use 15m, 1h, or seconds/);
    expect(() => parseInterval("240h")).toThrow(/168h0m0s/);
  });
});

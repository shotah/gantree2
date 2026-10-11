import { describe, expect, it } from "vitest";
import { TRUNCATION_MARKER, truncate } from "@/brain/tools/truncate";

describe("truncate", () => {
  it("leaves short text and non-positive caps alone", () => {
    expect(truncate("hi", 10)).toBe("hi");
    expect(truncate("hi", 0)).toBe("hi");
    expect(truncate("hi", -1)).toBe("hi");
    expect(truncate("", 10)).toBe("");
  });

  it("cuts to max runes and appends the Go marker", () => {
    const keep = 20 - Array.from(TRUNCATION_MARKER).length;
    const got = truncate("x".repeat(100), 20);
    expect(Array.from(got).length).toBe(20);
    expect(got).toBe("x".repeat(keep) + TRUNCATION_MARKER);
    expect(got).toContain("truncated");
  });

  it("counts a surrogate pair as one rune", () => {
    const cap = Array.from(TRUNCATION_MARKER).length + 2;
    const got = truncate("👋".repeat(30), cap);
    expect(Array.from(got).length).toBe(cap);
    expect(got.startsWith("👋👋")).toBe(true);
    expect(got.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("keeps one rune when the marker is longer than the cap", () => {
    const got = truncate("abcdef", 1);
    expect(got.startsWith("a")).toBe(true);
    expect(got.endsWith(TRUNCATION_MARKER)).toBe(true);
  });
});

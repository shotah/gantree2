import { describe, expect, it } from "vitest";
import { temporalAnchor } from "@/harness/agent/temporal";

describe("temporalAnchor", () => {
  it("formats NOW and day triplet for a fixed instant in America/Los_Angeles", () => {
    const ms = Date.parse("2026-11-14T08:18:00-08:00");
    const block = temporalAnchor(ms, "America/Los_Angeles", "America/Los_Angeles");
    expect(block).toContain("NOW: Saturday November 14, 2026 8:18 AM");
    expect(block).toContain(
      "yesterday=2026-11-13 (Friday) · today=2026-11-14 (Saturday) · tomorrow=2026-11-15 (Sunday)",
    );
  });

  it("ends with the Check NOW guidance line", () => {
    const ms = Date.parse("2026-11-14T08:18:00-08:00");
    const block = temporalAnchor(ms, "America/Los_Angeles", "America/Los_Angeles");
    const lastLine = block.split("\n").at(-1) ?? "";
    expect(lastLine.startsWith("Check NOW before any weekday")).toBe(true);
  });
});

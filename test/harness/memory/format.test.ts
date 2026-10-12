import { describe, expect, it } from "vitest";
import { formatHydration, KIND_EPISODE, KIND_FACT } from "@/harness/memory";
import { entry } from "./fixture";

describe("formatHydration", () => {
  it("stamps the local weekday and date", () => {
    const createdAt = Date.parse("2026-08-10T21:00:00-07:00");
    const got = formatHydration([entry({
      kind: KIND_EPISODE,
      subject: "ada",
      content: "skipped gym while traveling",
      createdAt,
    })], "America/Los_Angeles");
    expect(got).toContain("(episode, Mon 2026-08-10)");
    expect(got).not.toContain("2026-08-11");
  });

  it("omits the date when createdAt is zero", () => {
    const got = formatHydration([entry({
      kind: KIND_FACT,
      subject: "climbing",
      content: "trains Tue/Thu",
    })], "UTC");
    expect(got).toBe("[memory]\n- (fact) climbing: trains Tue/Thu");
  });
});

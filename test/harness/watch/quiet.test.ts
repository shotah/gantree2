import { describe, expect, it } from "vitest";
import { quietResumeAt } from "@/harness/watch";

const SLEEP = "sleep: 23:00-07:00\nwork: 09:00-17:00\nquiet: (none)\n";

describe("quietResumeAt", () => {
  it("ends an overnight sleep window on the next morning", () => {
    expect(quietResumeAt(SLEEP, Date.UTC(2026, 0, 1, 23, 30), "UTC")).toBe(Date.UTC(2026, 0, 2, 7, 0));
    expect(quietResumeAt(SLEEP, Date.UTC(2026, 0, 2, 2, 0), "UTC")).toBe(Date.UTC(2026, 0, 2, 7, 0));
    expect(quietResumeAt(SLEEP, Date.UTC(2026, 0, 1, 22, 0), "UTC")).toBeNull();
    expect(quietResumeAt(SLEEP, Date.UTC(2026, 0, 2, 7, 0), "UTC")).toBeNull();
    expect(quietResumeAt(SLEEP, Date.UTC(2026, 0, 1, 12, 0), "UTC")).toBeNull();
  });

  it("treats a quiet line as a window and ignores work", () => {
    expect(quietResumeAt("quiet: 12:00-13:00\n", Date.UTC(2026, 0, 1, 12, 30), "UTC"))
      .toBe(Date.UTC(2026, 0, 1, 13, 0));
    expect(quietResumeAt("work: 09:00-17:00\n", Date.UTC(2026, 0, 1, 12, 0), "UTC")).toBeNull();
    expect(quietResumeAt("", Date.UTC(2026, 0, 1, 2, 0), "UTC")).toBeNull();
  });

  it("uses the human zone", () => {
    // 2026-01-02 07:30 UTC is 2026-01-01 23:30 in Los Angeles (PST).
    const at = Date.UTC(2026, 0, 2, 7, 30);
    expect(quietResumeAt(SLEEP, at, "America/Los_Angeles")).toBe(Date.UTC(2026, 0, 2, 15, 0));
  });
});

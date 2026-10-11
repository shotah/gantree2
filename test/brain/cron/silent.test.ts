import { isSilentReply } from "@/brain/cron/silent";
import { describe, expect, it } from "vitest";

describe("isSilentReply", () => {
  it("matches a leading [silent] line only", () => {
    const cases: { in: string; want: boolean }[] = [
      { in: "", want: false },
      { in: "   ", want: false },
      { in: "[silent]", want: true },
      { in: "  [SILENT]  ", want: true },
      { in: "[Silent]\nall-clear, garmin looks fine", want: true },
      { in: "[silent]\n\n— tools: garmin__sleep_get", want: true },
      { in: "hello [silent]", want: false },
      { in: "I'll stay [silent] this time", want: false },
      { in: "Time to submit your timecard.", want: false },
    ];
    for (const tc of cases) expect(isSilentReply(tc.in), tc.in).toBe(tc.want);
  });
});

import { isSilentReply } from "@/harness/cron/silent";
import { reactEmoji } from "@/harness/cron/react";
import { stripWaitTokens, stripWaitTokensLive } from "@/harness/cron/wait";
import { describe, expect, it } from "vitest";

describe("react tokens", () => {
  it("lifts the emoji and strips the token with wait markers", () => {
    const cases: { in: string; emoji: string; stripped: string }[] = [
      { in: "[react 👍]", emoji: "👍", stripped: "" },
      { in: "[REACT ❤️]", emoji: "❤️", stripped: "" },
      { in: "Set a 6pm wake to ask how it went.\n[react 👍]", emoji: "👍", stripped: "Set a 6pm wake to ask how it went." },
      { in: "Set a 6pm wake. [react 👍]", emoji: "👍", stripped: "Set a 6pm wake." },
      { in: "[react 👍]\n[wait]", emoji: "👍", stripped: "" },
      { in: "[react 👍] [wait]", emoji: "👍", stripped: "" },
      { in: "[react 🔥]\n[react 👍]", emoji: "🔥", stripped: "" },
      { in: "[react ]", emoji: "", stripped: "[react ]" },
      { in: "[react 👍", emoji: "", stripped: "[react 👍" },
      { in: "I will [react 👍] later", emoji: "", stripped: "I will [react 👍] later" },
      { in: "hello", emoji: "", stripped: "hello" },
      { in: "", emoji: "", stripped: "" },
    ];
    for (const tc of cases) {
      expect(reactEmoji(tc.in), tc.in).toBe(tc.emoji);
      expect(stripWaitTokens(tc.in), tc.in).toBe(tc.stripped);
    }
    expect(isSilentReply("[react 👍]")).toBe(false);
  });

  it("hides a trailing incomplete react token while streaming", () => {
    const cases: { in: string; want: string }[] = [
      { in: "Nice.\n[", want: "Nice." },
      { in: "Nice.\n[re", want: "Nice." },
      { in: "Nice.\n[react ", want: "Nice." },
      { in: "Nice.\n[react 👍", want: "Nice." },
      { in: "Nice.\n[react 👍]", want: "Nice." },
      { in: "Nice. [rea", want: "Nice." },
      { in: "Nice. [react 👍", want: "Nice." },
      { in: "Nice. [react 👍]", want: "Nice." },
      { in: "[react 👍", want: "" },
      { in: "[reach out]", want: "[reach out]" },
    ];
    for (const tc of cases) expect(stripWaitTokensLive(tc.in), JSON.stringify(tc.in)).toBe(tc.want);
  });
});

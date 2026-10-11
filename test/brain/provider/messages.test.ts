import { describe, expect, it } from "vitest";
import type { Message } from "@/brain/core/provider";
import { wireMessages, wireMessagesMode } from "@/brain/provider";

const kit: Message[] = [
  { role: "system", content: "You are Kit." },
  { role: "user", content: "what's near me" },
  { role: "system", content: "[harness]\n[location] 47.6\n[current time] NOW" },
];

describe("wireMessages", () => {
  it("keeps a trailing harness block for OpenAI", () => {
    const got = wireMessages("gpt-5.4", kit);
    expect(got).toHaveLength(3);
    expect(got[2]?.role).toBe("system");
    expect(got[2]?.content).toContain("[harness]");
    expect(got[0]?.content).toBe("You are Kit.");
    expect(got[1]?.content).toBe("what's near me");
  });

  it("folds every system block into one leading message for Gemini", () => {
    const input: Message[] = [
      { role: "system", content: "You are Kit." },
      { role: "user", content: "old" },
      { role: "assistant", content: "prior" },
      { role: "system", content: "[memory] a fact" },
      { role: "user", content: "what's near me" },
      { role: "system", content: "[harness]\n[location] 47.6, -122.3\n[current time] NOW" },
      { role: "system", content: "[system] wait note" },
    ];
    const got = wireMessages("gemini-3.6-flash", input);
    expect(got).toHaveLength(4);
    expect(got[0]?.role).toBe("system");
    const sys = got[0]?.content ?? "";
    expect(sys.startsWith("You are Kit.")).toBe(true);
    expect(sys).toContain("[location] 47.6");
    expect(sys).toContain("[current time] NOW");
    expect(sys).toContain("[memory] a fact");
    expect(sys).toContain("wait note");
    const persona = sys.indexOf("You are Kit.");
    const mem = sys.indexOf("[memory]");
    const harness = sys.indexOf("[harness]");
    const wait = sys.indexOf("wait note");
    expect(persona).toBeLessThan(mem);
    expect(mem).toBeLessThan(harness);
    expect(harness).toBeLessThan(wait);
    expect(got[1]).toMatchObject({ role: "user", content: "old" });
    expect(got[2]?.role).toBe("assistant");
    expect(got[3]?.content).toBe("what's near me");
    for (const message of got.slice(1)) {
      expect(message.role).not.toBe("system");
    }
  });

  it("lets the fold mode override the model name", () => {
    const input: Message[] = [
      { role: "system", content: "You are Kit." },
      { role: "user", content: "hi" },
      { role: "system", content: "[harness] NOW" },
    ];
    const one = wireMessagesMode("one", "gpt-5.4", input);
    expect(one).toHaveLength(2);
    expect(one[0]?.content.startsWith("You are Kit.")).toBe(true);
    expect(one[0]?.content.endsWith("[harness] NOW")).toBe(true);
    const many = wireMessagesMode("many", "gemini-3.6-flash", input);
    expect(many).toHaveLength(3);
    expect(many[2]?.content).toBe("[harness] NOW");
    expect(wireMessagesMode("", "gemini-3.6-flash", input)).toHaveLength(2);
    expect(wireMessagesMode("sideways", "gpt-5.4", input)).toHaveLength(3);
  });
});

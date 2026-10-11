import { describe, expect, it } from "vitest";
import { keepRecentUnstripped, roleAssistant, roleUser, stripFillerHistory, stripFillerWords } from "@/brain/session";

describe("stripFillerWords", () => {
  it("keeps tone and negation", () => {
    expect(stripFillerWords("the gull had a mortgage")).toBe("gull had mortgage");
    expect(stripFillerWords("that gull had a mortgage")).toBe("that gull had mortgage");
    const negation = stripFillerWords("do not call the tool");
    expect(negation).toContain("not");
    expect(negation).not.toContain(" the ");
    expect(stripFillerWords("just wait oh like")).toBe("just wait oh like");
    expect(stripFillerWords("the gull had a mortgage")).toContain("had");
  });

  it("drops long hedges and phrases and keeps quotes and politeness", () => {
    const hedge = stripFillerWords("actually check the calendar you know");
    expect(hedge).not.toContain("actually");
    expect(hedge).not.toContain("you know");
    expect(hedge).toContain("check");
    expect(hedge).toContain("calendar");
    expect(stripFillerWords("please thanks")).toBe("please thanks");
    expect(stripFillerWords("it was kind of late")).not.toContain("kind of");
    const quoted = stripFillerWords("he said \"actually the gull\" basically");
    expect(quoted).toContain("\"actually the gull\"");
    expect(quoted).not.toContain("basically");
    expect(stripFillerWords("really literally maybe")).toBe("really literally maybe");
  });

  it("preserves quoted spans", () => {
    const got = stripFillerWords("he said \"the gull had a mortgage\" to the room");
    expect(got).toContain("\"the gull had a mortgage\"");
    expect(got).not.toContain(" to the ");
  });
});

describe("stripFillerHistory", () => {
  it("leaves the tail verbatim and does not mutate the input", () => {
    const n = keepRecentUnstripped + 5;
    const msgs = Array.from({ length: n }, () => ({ role: roleUser, content: "the calendar on Tuesday" }));
    const last = msgs[n - 1];
    if (last) {
      last.content = "the last line stays the the the";
    }
    const out = stripFillerHistory(msgs);
    expect(out).toHaveLength(n);
    expect(out[0]?.content).not.toBe("the calendar on Tuesday");
    expect(out[0]?.content).toContain("calendar");
    expect(out[0]?.content).not.toContain(" the ");
    expect(out[n - 1]?.content).toBe("the last line stays the the the");
    expect(msgs[0]?.content).toBe("the calendar on Tuesday");
  });

  it("does not strip assistant turns", () => {
    const n = keepRecentUnstripped + 4;
    const msgs = Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 1 ? roleAssistant : roleUser,
      content: i % 2 === 1 ? "the day is clear" : "the calendar on Tuesday",
    }));
    const out = stripFillerHistory(msgs);
    expect(out[0]?.content).not.toBe("the calendar on Tuesday");
    expect(out[1]?.content).toBe("the day is clear");
  });

  it("leaves a short session untouched", () => {
    const msgs = [{ role: roleUser, content: "the short one" }];
    expect(stripFillerHistory(msgs)[0]?.content).toBe("the short one");
  });
});

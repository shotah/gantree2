import { describe, expect, it } from "vitest";
import {
  HELD_DRAFT_TTL_MS,
  HeldDrafts,
  blankDraft,
  clearsDraft,
  agentPublishedDraft,
  phoneMustNotPublishDraft,
} from "@/lib/chat/draft";

describe("draft frames", () => {
  it("only the crane may publish a draft bubble", () => {
    expect(phoneMustNotPublishDraft("phone", "draft")).toBe(true);
    expect(phoneMustNotPublishDraft("crane", "draft")).toBe(false);
    expect(phoneMustNotPublishDraft("phone", "reply")).toBe(false);
    expect(agentPublishedDraft("crane", "draft")).toBe(true);
    expect(agentPublishedDraft("phone", "draft")).toBe(false);
  });

  it("calls a draft blank when it has no words", () => {
    expect(blankDraft({})).toBe(true);
    expect(blankDraft({ text: " \n" })).toBe(true);
    expect(blankDraft({ text: "Looks like" })).toBe(false);
  });

  it("only reply and error end the held draft", () => {
    expect(clearsDraft("reply")).toBe(true);
    expect(clearsDraft("error")).toBe(true);
    expect(clearsDraft("push")).toBe(false);
    expect(clearsDraft("typing")).toBe(false);
    expect(clearsDraft(undefined)).toBe(false);
  });
});

describe("HeldDrafts", () => {
  it("keeps the latest text per sub and says whether a drop found one", () => {
    const held = new HeldDrafts();
    held.hold("1182", "Looks", 0);
    held.hold("1182", "Looks like", 1);
    held.hold("7", "Two", 1);
    expect(held.current("1182", 2)).toBe("Looks like");
    expect(held.current("7", 2)).toBe("Two");
    expect(held.current("none", 2)).toBeUndefined();
    expect(held.drop("1182")).toBe(true);
    expect(held.drop("1182")).toBe(false);
    expect(held.current("1182", 2)).toBeUndefined();
    held.clear();
    expect(held.current("7", 2)).toBeUndefined();
  });

  it("expires after the TTL unless words or typing keep it alive", () => {
    const held = new HeldDrafts();
    held.hold("1182", "Looks", 0);
    expect(held.current("1182", HELD_DRAFT_TTL_MS)).toBe("Looks");
    expect(held.current("1182", HELD_DRAFT_TTL_MS + 1)).toBeUndefined();
    expect(held.current("1182", 0)).toBeUndefined(); // forgotten, not just hidden

    held.hold("1182", "Looks", 0);
    held.touch("1182", 50_000);
    expect(held.current("1182", 50_000 + HELD_DRAFT_TTL_MS)).toBe("Looks");
    expect(held.current("1182", 50_001 + HELD_DRAFT_TTL_MS)).toBeUndefined();

    held.touch("ghost", 0); // typing with nothing held holds nothing
    expect(held.current("ghost", 0)).toBeUndefined();
  });
});

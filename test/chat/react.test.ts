import { describe, expect, it } from "vitest";
import { parseFrame } from "@/lib/chat/frame";
import { shouldQueue } from "@/lib/chat/queue";
import {
  applyReaction,
  asReactions,
  agentPublishedReact,
  encodeReaction,
  parseReactionText,
  REACTION_PALETTE,
  REACTION_TEXT_MAX,
  reactionFor,
  reactionFramesFor,
  toggleReaction,
} from "@/lib/chat/react";
import { resolvePhoneKind } from "@/lib/chat/route";
import { shouldTranscript } from "@/lib/chat/transcript";

describe("react frame", () => {
  it("is a known kind a phone may send, never queued or transcribed", () => {
    const parsed = parseFrame(JSON.stringify({ kind: "react", id: "r1", text: "👍" }));
    expect(parsed.ok && parsed.frame.kind).toBe("react");
    expect(resolvePhoneKind({ kind: "react", id: "r1", text: "👍" })).toBe("react");
    expect(shouldQueue("react")).toBe(false);
    expect(shouldTranscript("react")).toBe(false);
    expect(agentPublishedReact("crane", "react")).toBe(true);
    expect(agentPublishedReact("phone", "react")).toBe(false);
  });

  it("normalizes the emoji set and refuses junk", () => {
    expect(parseReactionText("👍")).toBe("👍");
    expect(parseReactionText("  ❤️   🔥 ")).toBe("❤️ 🔥");
    expect(parseReactionText("")).toBe("");
    expect(parseReactionText("   ")).toBe("");
    expect(parseReactionText(undefined)).toBe("");
    expect(parseReactionText(null)).toBe("");
    expect(parseReactionText(7)).toBeUndefined();
    expect(parseReactionText("👍\u0000")).toBeUndefined();
    expect(parseReactionText("👨‍👩‍👧")).toBe("👨‍👩‍👧"); // ZWJ sequences pass
    expect(parseReactionText("🔥".repeat(REACTION_TEXT_MAX))).toBeUndefined();
    for (const emoji of REACTION_PALETTE) {
      expect(parseReactionText(emoji)).toBe(emoji);
    }
  });

  it("shapes a reaction from either side; the crane must name the human", () => {
    expect(reactionFor("crane", { kind: "react", user_id: "1182", id: "m1", text: "👍" }))
      .toEqual({ userId: "1182", id: "m1", text: "👍" });
    expect(reactionFor("crane", { kind: "react", id: "m1", text: "👍" })).toBeUndefined();
    expect(reactionFor("phone", { kind: "react", user_id: "1182", id: "r1", text: "" }))
      .toEqual({ userId: "1182", id: "r1", text: "" });
    expect(reactionFor("phone", { kind: "react", id: "r1", text: "👍" }))
      .toEqual({ userId: "", id: "r1", text: "👍" });
    expect(reactionFor("phone", { kind: "react", user_id: "1182", text: "👍" })).toBeUndefined();
    expect(reactionFor("phone", { kind: "react", user_id: "1182", id: "r1", text: "a\u0007" })).toBeUndefined();
    expect(reactionFor("phone", { kind: "inbound", user_id: "1182", id: "r1", text: "👍" })).toBeUndefined();
  });

  it("encodes with user_id only when known and replay only on hydrate", () => {
    expect(encodeReaction({ userId: "1182", id: "m1", text: "👍" }))
      .toEqual({ kind: "react", id: "m1", text: "👍", user_id: "1182" });
    expect(encodeReaction({ userId: "", id: "m1", text: "👍" }))
      .toEqual({ kind: "react", id: "m1", text: "👍" });
    expect(encodeReaction({ userId: "1182", id: "m1", text: "👍" }, true).replay).toBe(true);
  });
});

describe("reactions store", () => {
  it("reads junk as empty and drops blank entries", () => {
    expect(asReactions(null)).toEqual({});
    expect(asReactions([])).toEqual({});
    expect(asReactions({ m1: "👍", m2: "", m3: 4 })).toEqual({ m1: "👍" });
  });

  it("sets, replaces, clears, and prunes to the transcript", () => {
    const keep = new Set(["m1", "r1", "r2"]);
    let cur = applyReaction({}, { userId: "1182", id: "m1", text: "👍" }, keep);
    expect(cur).toEqual({ m1: "👍" });
    cur = applyReaction(cur, { userId: "1182", id: "r1", text: "❤️" }, keep);
    cur = applyReaction(cur, { userId: "1182", id: "m1", text: "🔥" }, keep);
    expect(cur).toEqual({ m1: "🔥", r1: "❤️" });
    cur = applyReaction(cur, { userId: "1182", id: "m1", text: "" }, keep);
    expect(cur).toEqual({ r1: "❤️" });
    // A bubble the transcript no longer has takes no reaction and loses its old one.
    cur = applyReaction({ gone: "👍", r1: "❤️" }, { userId: "1182", id: "old", text: "👍" }, keep);
    expect(cur).toEqual({ r1: "❤️" });
  });

  it("caps how many it keeps, oldest out", () => {
    const keep = new Set(["a", "b", "c"]);
    let cur = applyReaction({}, { userId: "1182", id: "a", text: "👍" }, keep, 2);
    cur = applyReaction(cur, { userId: "1182", id: "b", text: "👍" }, keep, 2);
    cur = applyReaction(cur, { userId: "1182", id: "c", text: "👍" }, keep, 2);
    expect(Object.keys(cur)).toEqual(["b", "c"]);
  });

  it("hydrates one replay-tagged react per painted bubble, in thread order", () => {
    const frames = reactionFramesFor("1182", { r2: "👍", m1: "❤️", stale: "🔥" }, ["m1", "r1", "r2"]);
    expect(frames).toEqual([
      { kind: "react", id: "m1", text: "❤️", user_id: "1182", replay: true },
      { kind: "react", id: "r2", text: "👍", user_id: "1182", replay: true },
    ]);
  });

  it("toggles: same emoji clears, another replaces", () => {
    expect(toggleReaction(undefined, "👍")).toBe("👍");
    expect(toggleReaction("👍", "👍")).toBe("");
    expect(toggleReaction("👍", "❤️")).toBe("❤️");
  });
});

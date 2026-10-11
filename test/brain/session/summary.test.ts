import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import type { ChatProvider, ChatRequest, ChatResult } from "@/brain/core/provider";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { ledgerParts, LlmSummarizer, roleAssistant, roleUser, SessionStore, voiceDelta } from "@/brain/session";

class FoldCompleter implements ChatProvider {
  requests: ChatRequest[] = [];
  constructor(private readonly body: string) {}

  complete(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    return Promise.resolve({ content: this.body, toolCalls: [], usage: { prompt: 0, completion: 0 } });
  }

  completeStream(req: ChatRequest): Promise<ChatResult> {
    return this.complete(req);
  }
}

function open(maxMessages: number): SessionStore {
  return new SessionStore(nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase), fixedClock(Date.parse("2026-08-17T16:22:00.000Z")), silentLogger, {
    maxMessages,
    maxEstTokens: 100_000,
  });
}

describe("rolling summary", () => {
  it("folds trimmed turns and clears the summary on reset", async () => {
    const store = open(4);
    const completer = new FoldCompleter("Facts: ada likes espresso\nVoice: gag: \"that gull had a mortgage\"");
    let hookedPrior = "";
    let hookedNext = "";
    store.withSummarizer(new LlmSummarizer(completer));
    store.withFoldHook((prior, next) => {
      hookedPrior = prior;
      hookedNext = next;
    });
    const id = "s1";
    for (let i = 0; i < 3; i++) {
      await store.append(id, { role: roleUser, content: "u" }, { role: roleAssistant, content: "a" });
    }
    expect(store.summary(id)).toContain("espresso");
    expect(hookedNext).toContain("gull");
    expect(hookedPrior).toBe("");
    store.reset(id);
    expect(store.summary(id)).toBe("");
  });

  it("splits Facts and Voice, and treats an unlabeled paragraph as facts", () => {
    const labeled = ledgerParts("Facts: likes espresso\nVoice: dry; gag: \"gull\"");
    expect(labeled.facts).toBe("likes espresso");
    expect(labeled.voice).toContain("gull");
    const legacy = ledgerParts("unlabeled legacy paragraph");
    expect(legacy.facts).toBe("unlabeled legacy paragraph");
    expect(legacy.voice).toBe("");
  });

  it("sends the voice-ledger prompt", async () => {
    const completer = new FoldCompleter("Facts: Ada likes espresso.\nVoice: gag: \"that gull had a mortgage.\"");
    const got = await new LlmSummarizer(completer).fold("prior", [
      { role: roleUser, content: "remember the seagull?" },
      { role: roleAssistant, content: "that gull had a mortgage" },
    ]);
    expect(got).toContain("gull");
    expect(got).toContain("Facts:");
    expect(got).toContain("Voice:");
    const sys = completer.requests[0]?.messages[0]?.content ?? "";
    for (const want of ["Facts:", "Voice:", "UNCHANGED", "paraphrased joke is a dead joke", "SELF.md", "8–12", "Keep up to 8"]) {
      expect(sys).toContain(want);
    }
    expect(sys.includes("one tight paragraph.") && !sys.includes("Facts:")).toBe(false);
  });

  it("returns only a new joke, not copied voice or mood weather", () => {
    const prior = "Facts: espresso\nVoice: dry; gag: \"that gull had a mortgage\"";
    const next = "Facts: espresso\nVoice: dry; gag: \"that gull had a mortgage\"; he is \"Chef\" this week";
    const got = voiceDelta(prior, next);
    expect(got).toContain("Chef");
    expect(got).not.toContain("gull");
    expect(got).not.toContain("dry");
    expect(voiceDelta(next, next)).toBe("");
    expect(voiceDelta(prior, "Facts: espresso\nVoice: dry today")).toBe("");
  });

  it("copies prior Voice forward when the model drops it", async () => {
    const prior = "Facts: likes espresso\nVoice: dry; gag: \"that gull had a mortgage\"";
    const completer = new FoldCompleter("Ada asked about Tuesday calendar.");
    const got = await new LlmSummarizer(completer).fold(prior, [
      { role: roleUser, content: "what's Tuesday?" },
      { role: roleAssistant, content: "checking the calendar" },
    ]);
    expect(got).toContain("Facts:");
    expect(got).toContain("Tuesday");
    expect(got).toContain("Voice:");
    expect(got).toContain("gull");
  });
});

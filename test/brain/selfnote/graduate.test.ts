import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { graduateVoice, restoreQuotedLines, SelfNoteStore } from "@/brain/selfnote";

function open(): SelfNoteStore {
  return new SelfNoteStore(nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase), fixedClock(1), silentLogger);
}

describe("graduateVoice", () => {
  it("appends a new joke once", () => {
    const store = open();
    const prior = "Facts: leftover\nVoice: dry";
    const next = "Facts: leftover\nVoice: dry; gag: \"that gull had a mortgage\"";
    expect(graduateVoice(store, prior, next)).toBe(true);
    const got = store.read();
    expect(got).toContain("gull");
    expect(graduateVoice(store, next, next)).toBe(false);
    const restated = "Facts: leftover\nVoice: gag: \"that gull had a mortgage\"";
    expect(graduateVoice(store, prior, restated)).toBe(false);
    const again = store.read();
    expect(again.split("gull").length - 1).toBe(got.split("gull").length - 1);
  });

  it("skips mood weather", () => {
    const store = open();
    expect(graduateVoice(store, "Facts: x\nVoice: dry", "Facts: x\nVoice: dry today")).toBe(false);
  });
});

describe("restoreQuotedLines", () => {
  it("puts a dropped joke back and does not duplicate it", () => {
    const prior = "# SELF.md — Who You Are Becoming\n\n> header\n\n- gag: \"that gull had a mortgage\"\n- dry humor";
    const next = "# SELF.md — Who You Are Becoming\n- dry humor";
    const got = restoreQuotedLines(prior, next);
    expect(got).toContain("gull");
    expect(got).toContain("dry humor");
    const again = restoreQuotedLines(prior, got);
    expect(again.split("gull").length - 1).toBe(got.split("gull").length - 1);
    expect(restoreQuotedLines("", next)).toBe(next);
  });
});

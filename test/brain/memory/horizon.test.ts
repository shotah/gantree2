import { describe, expect, it } from "vitest";
import {
  formatAims,
  formatAimsEmpty,
  formatAimsNoted,
  formatLoops,
  HORIZON_MAX,
  SUBJECT_AIM_BOOTSTRAP,
} from "@/brain/memory";
import { entry } from "./fixture";

describe("horizon", () => {
  it("formats aims and interleaved loops", () => {
    expect(formatAims(null)).toBe("");
    expect(formatLoops(null, null)).toBe("");
    const aims = formatAims([
      entry({ subject: "aim/training", content: "3x gym this month" }),
      entry({ subject: "aim/spanish", content: "B1 by summer" }),
    ]);
    expect(aims).toBe("[aims] training: 3x gym this month · spanish: B1 by summer");
    const loops = formatLoops(
      [entry({ subject: "waiting/dentist", content: "book cleaning" })],
      [entry({ subject: "follow/visa", content: "packet in" })],
    );
    expect(loops).toBe("[loops] waiting/dentist: book cleaning · follow/visa: packet in");
  });

  it("stamps the day the months-scale question was asked", () => {
    expect(formatAimsEmpty(null)).toBe("");
    const asked = entry({
      subject: SUBJECT_AIM_BOOTSTRAP,
      updatedAt: Date.UTC(2026, 8, 16, 4, 30, 0),
    });
    const now = Date.UTC(2026, 8, 16, 13, 0, 0);
    expect(formatAimsEmpty(asked, now, "America/Los_Angeles")).toBe("[aims] none (asked 2026-09-15)");
    expect(formatAimsEmpty(entry({ subject: SUBJECT_AIM_BOOTSTRAP }), now, "America/Los_Angeles"))
      .toBe("[aims] none (asked)");
  });

  it("suffixes a note and caps the line", () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({
      subject: `aim/${String.fromCharCode(97 + i)}`,
      content: "n",
    }));
    const got = formatAimsNoted(many, 0, { a: "30d +1.0 · 7d +2 · streak 1" });
    expect(got).toContain("a: n — 30d +1.0 · 7d +2 · streak 1");
    expect(got).not.toContain("f: n");
    expect(got).toContain("(+1 more — memory_recall aim/)");
  });

  it("clips a long aim and counts the overflow", () => {
    const clipped = formatAims([entry({ subject: "aim/x", content: "x".repeat(90) })]);
    expect(clipped.startsWith("[aims] x: ")).toBe(true);
    expect(clipped.endsWith("\u2026")).toBe(true);
    const many = Array.from({ length: 8 }, (_, i) => entry({
      subject: `aim/${String.fromCharCode(97 + i)}`,
      content: "n",
    }));
    const got = formatAims(many);
    expect(got.split(" · ").length - 1).toBe(HORIZON_MAX - 1);
    expect(got.endsWith(" (+3 more — memory_recall aim/)")).toBe(true);
  });

  it("keeps a follow visible beside five waits", () => {
    const waiting = Array.from({ length: 5 }, (_, i) => entry({
      subject: `waiting/w${String.fromCharCode(48 + i)}`,
      content: "n",
    }));
    const got = formatLoops(waiting, [entry({ subject: "follow/visa", content: "packet in" })]);
    expect(got).toContain("follow/visa: packet in");
    expect(got.startsWith("[loops] waiting/w0: n · follow/visa: packet in · waiting/w1")).toBe(true);
    expect(got.endsWith(" (+1 more — memory_recall waiting/ follow/)")).toBe(true);
  });

  it("stamps day ages and a stale cue on loops only", () => {
    const now = Date.UTC(2026, 8, 14, 12, 0, 0);
    const day = 24 * 60 * 60 * 1000;
    const fresh = entry({ subject: "aim/a", content: "n", updatedAt: now - 3 * 60 * 60 * 1000 });
    const old = entry({ subject: "aim/b", content: "n", updatedAt: now - 12 * day });
    expect(formatAims([fresh, old], now)).toBe("[aims] a: n · b: n (12d ago)");
    const stale = entry({ subject: "waiting/dentist", content: "book", createdAt: now - 35 * day });
    expect(formatLoops([stale], null, now)).toBe("[loops] waiting/dentist: book (35d ago — resolve or memory_forget)");
    const live = entry({ subject: "follow/visa", content: "packet", updatedAt: now - 2 * day });
    expect(formatLoops(null, [live], now)).toBe("[loops] follow/visa: packet (2d ago)");
  });
});

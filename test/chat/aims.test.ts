import { describe, expect, it } from "vitest";
import {
  AIM_DAYS_MAX,
  AIM_LINKS_MAX,
  AIM_WEEKS_MAX,
  AIMS_MAX,
  aimsStoreKey,
  agentPublishedAims,
  dayLabel,
  linkLine,
  parseAimsBoard,
  parseAimsFrame,
  parseLinks,
  parseWeeks,
  phoneMustNotPublishAims,
  signed,
  statsLine,
} from "@/lib/chat/aims";
import { parseFrame } from "@/lib/chat/frame";
import { shouldQueue } from "@/lib/chat/queue";

const training = {
  area: "training",
  sentence: "gym 3 mornings/wk",
  rating30: 1.4,
  sum7: 6,
  streak: 2,
  note: "asked",
  note_at: "2026-09-25",
  days: [
    { day: "2026-09-22", score: 2, events: [411] },
    { day: "2026-09-23", score: -1, events: [413] },
    { day: "2026-09-24", score: 0, events: [] },
    { day: "2026-09-25", score: 3, events: [415] },
    { day: "2026-09-26", score: 0, events: [416] },
  ],
  weeks: [
    { start: "2026-09-13", mean: 0.9, up: 3, against: 1, metrics: [] },
    { start: "2026-09-20", mean: 1.4, up: 4, against: 1, metrics: [{ metric: "weight", mean: 191.4, unit: "lb", n: 3 }] },
  ],
  slope: 0.3,
  block: { days: 10, up: 4, against: 2, mean: 0.4, pct: 0.4 },
  effect: { a: "training", b: "", metric: "weight", r: -0.42, n: 9 },
};

describe("aims frame", () => {
  it("is a crane-only kind, never queued, parsed into the frame", () => {
    expect(agentPublishedAims("crane", "aims")).toBe(true);
    expect(agentPublishedAims("phone", "aims")).toBe(false);
    expect(phoneMustNotPublishAims("phone", "aims")).toBe(true);
    expect(phoneMustNotPublishAims("crane", "aims")).toBe(false);
    expect(shouldQueue("aims")).toBe(false);
    const parsed = parseFrame(JSON.stringify({ kind: "aims", aims: [training] }));
    expect(parsed.ok && parsed.frame.aims?.[0]?.area).toBe("training");
    expect(aimsStoreKey()).toBe("aims");
    expect(aimsStoreKey("1182")).toBe("aims:1182");
  });
});

describe("parseAimsBoard", () => {
  it("keeps a full row with its optional lines", () => {
    const [row] = parseAimsBoard([training]);
    expect(row).toEqual(training);
  });

  it("drops junk, bad rows, duplicates, and caps rows and days", () => {
    expect(parseAimsBoard(null)).toEqual([]);
    expect(parseAimsBoard({})).toEqual([]);
    const rows = parseAimsBoard([
      7,
      { area: "Weight ", sentence: "under 190 by spring" },
      { area: "weight", sentence: "dup" },
      { area: "no sentence" },
      { area: "bad area!", sentence: "x" },
      ...Array.from({ length: AIMS_MAX + 2 }, (_, i) => ({ area: `a${i}`, sentence: `aim ${i}` })),
    ]);
    expect(rows).toHaveLength(AIMS_MAX);
    expect(rows[0]).toEqual({ area: "weight", sentence: "under 190 by spring", rating30: 0, sum7: 0, streak: 0, note: "", days: [] });
    const [long] = parseAimsBoard([{
      area: "t",
      sentence: "s",
      rating30: 9,
      streak: -4,
      days: Array.from({ length: AIM_DAYS_MAX + 3 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, score: 7, events: ["x", 3] })),
    }]);
    expect(long?.rating30).toBe(3);
    expect(long?.streak).toBe(0);
    expect(long?.days).toHaveLength(AIM_DAYS_MAX);
    expect(long?.days[0]).toEqual({ day: "2026-09-01", score: 3, events: [3] });
  });

  it("keeps week buckets oldest first, capped, with per-unit metric means; drops junk weeks", () => {
    const weeks = parseWeeks([
      { start: "2026-09-13", mean: 9, up: -1, metrics: [{ metric: "weight", mean: 191.4, unit: "lb", n: 3 }, { metric: "x" }] },
      { start: "not a day", mean: 1 },
      { start: "2026-09-20", mean: "1" },
      ...Array.from({ length: AIM_WEEKS_MAX + 2 }, (_, i) => ({ start: `2026-01-${String(i + 1).padStart(2, "0")}`, mean: 0 })),
    ]);
    expect(weeks).toHaveLength(AIM_WEEKS_MAX);
    expect(weeks[0]).toEqual({ start: "2026-09-13", mean: 3, up: 0, against: 0, metrics: [{ metric: "weight", mean: 191.4, unit: "lb", n: 3 }] });
    const [row] = parseAimsBoard([{ area: "t", sentence: "s", weeks: [] }]);
    expect(row?.weeks).toBeUndefined();
  });

  it("keeps cross-aim links in the order sent, capped, both areas named and distinct", () => {
    const links = parseLinks([
      { a: "Training", b: "weight", r: 0.38, n: 12 },
      { a: "weight", b: "weight", r: 0.9, n: 12 },
      { a: "drinking", b: "climbing", r: -2, n: 9 },
      { a: "x", b: "y", r: 0.5 },
      { a: "a1", b: "b1", r: 0.31, n: 8 },
      { a: "a2", b: "b2", r: 0.3, n: 8 },
    ]);
    expect(links).toEqual([
      { a: "training", b: "weight", r: 0.38, n: 12 },
      { a: "drinking", b: "climbing", r: -1, n: 9 },
      { a: "a1", b: "b1", r: 0.31, n: 8 },
    ]);
    expect(links).toHaveLength(AIM_LINKS_MAX);
    expect(linkLine(links[0])).toBe("training → next-day weight r +0.38 (n 12)");
    expect(parseAimsFrame({ aims: [training], links: links.slice(0, 1) })).toEqual({
      aims: [training],
      links: [{ a: "training", b: "weight", r: 0.38, n: 12 }],
    });
    const parsed = parseFrame(JSON.stringify({ kind: "aims", aims: [training], links }));
    expect(parsed.ok && parsed.frame.links).toHaveLength(3);
  });

  it("omits a half-formed block or effect instead of inventing numbers", () => {
    const [row] = parseAimsBoard([{
      area: "t",
      sentence: "s",
      block: { days: 10, up: 4 },
      effect: { r: "0.5", n: 9 },
      slope: "up",
      note_at: "yesterday",
    }]);
    expect(row?.block).toBeUndefined();
    expect(row?.effect).toBeUndefined();
    expect(row?.slope).toBeUndefined();
    expect(row?.note_at).toBeUndefined();
  });
});

describe("aims text", () => {
  it("signs numbers the way the stamp does", () => {
    expect(signed(1.4, 1)).toBe("+1.4");
    expect(signed(-0.34, 1)).toBe("-0.3");
    expect(signed(0, 1)).toBe("0.0");
    expect(signed(6)).toBe("+6");
    expect(signed(0)).toBe("0");
    expect(signed(-0.04, 1)).toBe("0.0");
  });

  it("matches the [aims] suffix and names the day", () => {
    const row = parseAimsBoard([training])[0];
    expect(statsLine(row)).toBe("30d +1.4 · 7d +6 · streak 2 · asked");
    expect(statsLine({ ...row, streak: 0, note: "" })).toBe("30d +1.4 · 7d +6");
    expect(dayLabel(row.days[0])).toMatch(/^\w{3} \+2$/u);
    expect(dayLabel(row.days[2])).toMatch(/no event$/u);
  });
});

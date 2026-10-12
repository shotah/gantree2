import { SCORE_MAX, effect, pearson, progress, stampCorr, suffix, weekSlope } from "@/harness/aims";
import { type AimWeek } from "@/lib/chat/aims";
import { describe, expect, it } from "vitest";
import { LA, localInstant, openFixture } from "./fixture";

describe("day scores", () => {
  it("clamps the day and fills missing days", () => {
    const { store, mem } = openFixture();
    mem.seed("training");
    for (const what of ["am", "pm"]) {
      store.log({ what, day: "2026-09-22" }, { training: 2 });
    }
    const days = store.dayScores("training", "2026-09-21", "2026-09-23");
    expect(days).toHaveLength(3);
    expect(days[0]?.score).toBe(0);
    expect(days[0]?.events).toEqual([]);
    expect(days[1]?.score).toBe(SCORE_MAX);
    expect(days[1]?.events).toHaveLength(2);
    expect(days[2]?.day).toBe("2026-09-23");
    expect(days[2]?.score).toBe(0);
  });

  it("crosses a month boundary", () => {
    const { store, mem } = openFixture(LA);
    mem.seed("training");
    store.log({ what: "sept", day: "2026-09-30" }, { training: 1 });
    store.log({ what: "oct", day: "2026-10-01" }, { training: 2 });
    const days = store.dayScores("training", "2026-09-30", "2026-10-01");
    expect(days.map((day) => [day.day, day.score])).toEqual([
      ["2026-09-30", 1],
      ["2026-10-01", 2],
    ]);
  });
});

describe("stats", () => {
  it("keeps yesterday's streak when today is empty, and ends it on a scored zero", () => {
    const now = localInstant(LA, 2026, 9, 27, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("training");
    store.log({ what: "session", day: "2026-09-26" }, { training: 2 });
    let st = store.statsAt("training", now);
    expect(st.streak).toBe(1);
    expect(st.sum7).toBe(2);
    store.log({ what: "planned rest", day: "2026-09-27" }, { training: 0 });
    st = store.statsAt("training", now);
    expect(st.streak).toBe(0);
    store.log({ what: "session", day: "2026-09-27" }, { training: 2 });
    st = store.statsAt("training", now);
    expect(st.streak).toBe(2);
  });

  it("rates a sparse month as the mean over every day", () => {
    const now = Date.UTC(2026, 8, 27, 12, 0, 0);
    const { store, mem } = openFixture("UTC", now);
    mem.seed("training");
    store.log({ what: "pr", day: "2026-09-27" }, { training: 3 });
    const st = store.statsAt("training", now);
    expect(Math.abs(st.rating30 - 0.1)).toBeLessThan(0.001);
    expect(suffix(st)).toBe("30d +0.1 · 7d +3 · streak 1");
  });

  it("matches the fixture week", () => {
    const now = localInstant(LA, 2026, 9, 27, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("drinking", "weight", "climbing");
    const rows: {
      day: string;
      what: string;
      scores: Record<string, number>;
      note?: string;
      metric?: string;
      value?: number;
    }[] = [
      { day: "2026-09-21", what: "weighed in", scores: { weight: 0 }, metric: "weight", value: 193 },
      { day: "2026-09-21", what: "clean day", scores: { drinking: 1 } },
      { day: "2026-09-22", what: "ran five miles", scores: { weight: 1, climbing: 1 } },
      { day: "2026-09-22", what: "team dinner: 3 beers and a burger", scores: { drinking: -2, weight: -1, climbing: -1 } },
      { day: "2026-09-23", what: "skipped the morning session", scores: { climbing: -1 } },
      { day: "2026-09-23", what: "weighed in", scores: { weight: 0 }, metric: "weight", value: 193.8 },
      { day: "2026-09-24", what: "8 boulders, sent the V5 project", scores: { drinking: 1, climbing: 3 } },
      { day: "2026-09-25", what: "asked what is in the way of mornings", scores: { climbing: 0 }, note: "asked" },
      { day: "2026-09-26", what: "long hike, no beer", scores: { drinking: 1, weight: 1, climbing: 1 } },
      { day: "2026-09-27", what: "clean day, weighed in", scores: { drinking: 1, weight: 2 }, metric: "weight", value: 191.9 },
    ];
    for (const row of rows) {
      store.log(
        { what: row.what, day: row.day, note: row.note, metric: row.metric, value: row.value, unit: "lb" },
        row.scores,
      );
    }
    const drink = store.statsAt("drinking", now);
    expect(drink.sum7).toBe(2);
    expect(drink.up7).toBe(4);
    expect(drink.against7).toBe(1);
    expect(drink.streak).toBe(2);
    const weight = store.statsAt("weight", now);
    expect(weight.sum7).toBe(3);
    expect(weight.streak).toBe(2);
    const climb = store.statsAt("climbing", now);
    expect(climb.sum7).toBe(3);
    expect(climb.against7).toBe(1);
    expect(climb.streak).toBe(1);
    expect(climb.lastNote).toBe("asked");

    const ser = store.seriesAt("weight", "weight", "2026-09-21", "2026-09-27");
    expect(ser.ok).toBe(true);
    expect(ser.n).toBe(3);
    expect(ser.latest).toBe(191.9);
    expect(ser.unit).toBe("lb");
    expect(ser.slope).toBeLessThan(0);

    const days = store.dayScores("climbing", "2026-09-23", "2026-09-27");
    const grid = progress("climbing", days, climb, null, now);
    expect(grid).toContain("2026-09-25 0");
    expect(grid).toContain("asked");
    expect(grid).toContain("2026-09-27 ·");

    const weeks = store.weeks("weight", now);
    expect(effect("weight", weeks).ok).toBe(false);
    expect(store.nextDay("drinking", "climbing", now).ok).toBe(false);
  });
});

describe("weeks", () => {
  it("clips the first bucket to the first event", () => {
    const now = localInstant(LA, 2026, 9, 26, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("training");
    store.log({ what: "session", day: "2026-09-23" }, { training: 2 });
    const weeks = store.weeks("training", now);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.start).toBe("2026-09-20");
    expect(weeks[0]?.up).toBe(1);
    expect(Math.abs((weeks[0]?.mean ?? 0) - 0.5)).toBeLessThan(0.001);
  });

  it("keeps an empty week inside the life of the aim", () => {
    const now = localInstant(LA, 2026, 9, 20, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("training");
    store.log({ what: "start", day: "2026-09-06" }, { training: 1 });
    const weeks = store.weeks("training", now);
    expect(weeks).toHaveLength(3);
    expect(weeks[1]?.start).toBe("2026-09-13");
    expect(weeks[1]?.mean).toBe(0);
  });

  it("keeps a month boundary in one Sunday bucket", () => {
    const now = localInstant(LA, 2026, 10, 3, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("training");
    for (const day of ["2026-09-30", "2026-10-01"]) {
      store.log({ what: day, day }, { training: 1 });
    }
    const weeks = store.weeks("training", now);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.start).toBe("2026-09-27");
  });

  it("keeps mixed units as two measures", () => {
    const now = localInstant(LA, 2026, 9, 26, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("weight");
    store.log({ what: "lb", day: "2026-09-21", metric: "weight", value: 190, unit: "lb" }, { weight: 0 });
    store.log({ what: "kg", day: "2026-09-22", metric: "weight", value: 86, unit: "kg" }, { weight: 0 });
    const weeks = store.weeks("weight", now);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.metrics).toHaveLength(2);
    const units = new Set(weeks[0]?.metrics.map((m) => m.unit));
    expect(units).toEqual(new Set(["lb", "kg"]));
    for (const measure of weeks[0]?.metrics ?? []) {
      expect(measure.metric).toBe("weight");
      expect(measure.n).toBe(1);
    }
  });
});

describe("week slope", () => {
  it("is flat at zero and steps up", () => {
    const flat = [{ mean: 1 }, { mean: 1 }, { mean: 1 }];
    const flatSlope = weekSlope(flat);
    expect(flatSlope.ok).toBe(true);
    expect(flatSlope.slope).toBe(0);
    expect(weekSlope(flat.slice(0, 1)).ok).toBe(false);
    const step = Array.from({ length: 8 }, (_, i) => ({ mean: i >= 4 ? 2 : 0 }));
    const stepSlope = weekSlope(step);
    expect(stepSlope.ok).toBe(true);
    expect(stepSlope.slope).toBeGreaterThan(0);
  });
});

describe("block stats", () => {
  it("clips the span to today", () => {
    const now = localInstant(LA, 2026, 10, 2, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("training");
    expect(store.blockStats("training", now).ok).toBe(false);
    store.setBlock("training", "2026-09-23", "2026-10-02");
    for (let i = 0; i < 4; i++) {
      const day = `2026-09-${String(23 + i)}`;
      store.log({ what: day, day }, { training: 1 + (i % 2) });
    }
    const full = store.blockStats("training", now);
    expect(full.ok).toBe(true);
    expect(full.stats.days).toBe(10);
    expect(full.stats.up).toBe(4);
    expect(Math.abs(full.stats.pct - 0.4)).toBeLessThan(0.001);

    store.setBlock("training", "2026-09-28", "2026-11-01");
    const clipped = store.blockStats("training", localInstant(LA, 2026, 9, 30, 12, 0));
    expect(clipped.ok).toBe(true);
    expect(clipped.stats.days).toBe(3);

    store.setBlock("training", "2026-09-30", "2026-10-02");
    const edge = store.blockStats("training", now);
    expect(edge.stats.days).toBe(3);
  });
});

describe("correlation", () => {
  it("gates Pearson and the effect stamp", () => {
    const same = [1, 2, 3, 4, 5, 6, 7, 8];
    const identical = pearson(same, same);
    expect(identical.ok).toBe(true);
    expect(Math.abs(identical.r - 1)).toBeLessThan(1e-9);
    expect(pearson(same.slice(0, 7), same.slice(0, 7)).ok).toBe(false);

    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const ys = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    const weak = pearson(xs, ys);
    expect(weak.ok).toBe(true);
    expect(Math.abs(weak.r)).toBeLessThan(0.3);
    expect(stampCorr(weak.ok, weak.r)).toBe(false);
    expect(stampCorr(true, 0.2)).toBe(false);
    expect(stampCorr(true, 0.3)).toBe(true);
    expect(stampCorr(false, 1)).toBe(false);

    const falling: AimWeek[] = [];
    for (let i = 0; i < 8; i++) {
      falling.push({
        start: "2026-01-04",
        mean: i,
        up: 0,
        against: 0,
        metrics: [{ metric: "weight", mean: 80 - i * 5, unit: "lb", n: 1 }],
      });
    }
    const got = effect("weight", falling);
    expect(got.ok).toBe(true);
    expect(got.corr.r).toBeLessThan(0);
    expect(got.corr.n).toBe(8);
    expect(got.corr.metric).toBe("weight");
    expect(effect("weight", falling.slice(0, 7)).ok).toBe(false);
  });

  it("counts only days the first aim was logged", () => {
    const now = Date.UTC(2026, 8, 27, 12, 0, 0);
    const { store, mem } = openFixture("UTC", now);
    mem.seed("drinking", "climbing");
    for (const day of ["2026-09-01", "2026-09-10", "2026-09-20"]) {
      store.log({ what: "night", day }, { drinking: -1 });
    }
    const got = store.nextDay("drinking", "climbing", now);
    expect(got.ok).toBe(false);
    expect(got.link.n).toBe(3);
  });
});

describe("progress text", () => {
  it("stamps weeks, slope, and r only on Sunday", () => {
    const { store, mem } = openFixture(LA);
    mem.seed("training", "weight");
    const sundays = [
      { day: "2026-08-02", score: 0, lb: 200 },
      { day: "2026-08-09", score: 0, lb: 198 },
      { day: "2026-08-16", score: 1, lb: 196 },
      { day: "2026-08-23", score: 1, lb: 194 },
      { day: "2026-08-30", score: 2, lb: 192 },
      { day: "2026-09-06", score: 2, lb: 190 },
      { day: "2026-09-13", score: 3, lb: 188 },
      { day: "2026-09-20", score: 3, lb: 186 },
      { day: "2026-09-27", score: 3, lb: 184 },
    ];
    for (const row of sundays) {
      store.log(
        { what: "week", day: row.day, metric: "weight", value: row.lb, unit: "lb" },
        { training: row.score, weight: row.score },
      );
    }
    store.setBlock("training", "2026-08-02", "2026-12-01");
    const sunday = localInstant(LA, 2026, 10, 4, 8, 0);
    let text = store.progressText(["training", "weight"], sunday);
    for (const part of ["weeks:", "slope", "r=", "block "]) {
      expect(text, part).toContain(part);
    }
    const wednesday = localInstant(LA, 2026, 10, 7, 8, 0);
    text = store.progressText(["training", "weight"], wednesday);
    expect(text).toContain("block ");
    for (const part of ["weeks:", "slope", "r=", "too early"]) {
      expect(text, part).not.toContain(part);
    }

    const short = openFixture(LA);
    short.mem.seed("training");
    for (const day of ["2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"]) {
      short.store.log({ what: "session", day }, { training: 1 });
    }
    text = short.store.progressText(["training"], sunday);
    expect(text).toContain("weeks:");
    expect(text).not.toContain("r=");
    expect(text).not.toContain("too early");

    const area = store.areaTrend("weight", wednesday);
    expect(area).toContain("weeks:");
  });
});

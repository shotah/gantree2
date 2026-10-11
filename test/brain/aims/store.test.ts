import { fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import { openAims, type AimEvent } from "@/brain/aims";
import { describe, expect, it } from "vitest";
import { LA, openFixture } from "./fixture";

function scoresOf(ev: AimEvent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sc of ev.scores) {
    out[sc.area] = sc.value;
  }
  return out;
}

describe("openAims", () => {
  it("rejects a nil db", () => {
    expect(() => openAims(null, fixedClock(0), silentLogger, null)).toThrow(/nil db/);
  });

  it("records aims.001 and aims.002 once", () => {
    const { sql } = openFixture();
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration ORDER BY id").map((row) => row.id))
      .toEqual(["aims.001", "aims.002"]);
    openAims(sql, fixedClock(0), silentLogger, null);
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration").length).toBe(2);
  });
});

describe("log", () => {
  it("writes nothing for an unknown area", () => {
    const { store, mem } = openFixture();
    mem.seed("climbing");
    expect(() => store.log({ what: "pizza", day: "2026-09-22" }, { weight: -2 }))
      .toThrow(/unknown area "weight"/);
    expect(() => store.log({ what: "pizza", day: "2026-09-22" }, { weight: -2 }))
      .toThrow(/climbing/);
    expect(store.history("", "", "", 10)).toEqual([]);
  });

  it("scores three aims on one event", () => {
    const { store, mem } = openFixture();
    mem.seed("climbing", "drinking", "weight");
    const ev = store.log(
      { what: "team dinner: 3 beers and a burger", day: "2026-09-22" },
      { drinking: -2, weight: -1, climbing: -1 },
    );
    expect(ev.id).not.toBe(0);
    expect(ev.what).toBe("team dinner: 3 beers and a burger");
    expect(ev.day).toBe("2026-09-22");
    expect(ev.scores).toHaveLength(3);
    expect(scoresOf(ev)).toEqual({ drinking: -2, weight: -1, climbing: -1 });
    const hist = store.history("drinking", "", "", 10);
    expect(hist).toHaveLength(1);
    expect(hist[0]?.id).toBe(ev.id);
    expect(hist[0]?.scores).toHaveLength(3);
  });

  it("appends unreferenced events on the same day", () => {
    const { store, mem } = openFixture();
    mem.seed("training", "weight");
    const a = store.log({ what: "ran five miles", day: "2026-09-22" }, { training: 2 });
    const b = store.log({ what: "dessert", day: "2026-09-22" }, { weight: -1 });
    expect(a.id).not.toBe(b.id);
    expect(store.history("", "2026-09-22", "2026-09-22", 10)).toHaveLength(2);
  });

  it("dedupes a ref by superseding the live row", () => {
    const { store, mem } = openFixture();
    mem.seed("training", "weight");
    const first = store.log(
      { what: "ran five miles", day: "2026-09-22", ref: "garmin:20481773" },
      { training: 2 },
    );
    const second = store.log(
      { what: "ran five miles", day: "2026-09-22", ref: "garmin:20481773" },
      { training: 2, weight: 1 },
    );
    expect(second.id).not.toBe(first.id);
    const old = store.get(first.id);
    expect(old.supersededBy).toBe(second.id);
    const hist = store.history("", "", "", 10);
    expect(hist).toHaveLength(1);
    expect(hist[0]?.id).toBe(second.id);
    expect(scoresOf(second)).toMatchObject({ training: 2, weight: 1 });
  });

  it("merges a score when rewriting by id", () => {
    const { store, mem } = openFixture();
    mem.seed("climbing", "drinking", "weight");
    const ev = store.log(
      { what: "team dinner", day: "2026-09-22" },
      { drinking: -2, weight: -1, climbing: -1 },
    );
    const rewritten = store.log({ id: ev.id }, { weight: 0 });
    expect(rewritten.what).toBe("team dinner");
    expect(rewritten.day).toBe("2026-09-22");
    expect(scoresOf(rewritten)).toEqual({ drinking: -2, climbing: -1, weight: 0 });
    const old = store.get(ev.id);
    expect(old.supersededBy).toBe(rewritten.id);
  });

  it("keeps a back-dated day", () => {
    const { store, mem } = openFixture();
    mem.seed("training");
    const ev = store.log({ what: "ran (self-reported)", day: "2026-09-16" }, { training: 2 });
    expect(ev.day).toBe("2026-09-16");
  });

  it("defaults the day in the human's zone", () => {
    // 02:00 UTC is still the previous evening in Los Angeles.
    const at = Date.parse("2026-10-12T02:00:00.000Z");
    const la = openFixture(LA, at);
    la.mem.seed("training");
    expect(la.store.log({ what: "rest" }, { training: 0 }).day).toBe("2026-10-11");
    const utc = openFixture("UTC", at);
    utc.mem.seed("training");
    expect(utc.store.log({ what: "rest" }, { training: 0 }).day).toBe("2026-10-12");
  });

  it("rejects a score outside -3..3", () => {
    const { store, mem } = openFixture();
    mem.seed("training");
    expect(() => store.log({ what: "x", day: "2026-09-22" }, { training: 4 })).toThrow(/must be -3\.\.3/);
  });

  it("rides a measurement along", () => {
    const { store, mem } = openFixture();
    mem.seed("weight");
    const ev = store.log(
      { what: "weighed in", day: "2026-09-22", metric: "weight", value: 191.9, unit: "lb", source: "tool" },
      { weight: 0 },
    );
    expect(ev.metric).toBe("weight");
    expect(ev.unit).toBe("lb");
    expect(ev.source).toBe("tool");
    expect(ev.value).toBe(191.9);
  });
});

describe("forget", () => {
  it("drops the area and keeps a shared event", () => {
    const { store, mem } = openFixture();
    mem.seed("climbing", "drinking", "weight");
    const shared = store.log(
      { what: "team dinner", day: "2026-09-22" },
      { drinking: -2, weight: -1, climbing: -1 },
    );
    const only = store.log({ what: "one beer", day: "2026-09-23" }, { drinking: -1 });
    store.forget("drinking");
    const orphan = store.get(only.id);
    expect(orphan.supersededBy).not.toBeNull();
    const kept = store.get(shared.id);
    expect(kept.supersededBy).toBeNull();
    const got = scoresOf(kept);
    expect(got.drinking).toBeUndefined();
    expect(got.weight).toBe(-1);
    expect(got.climbing).toBe(-1);
    expect(store.history("drinking", "", "", 10)).toEqual([]);
  });
});

describe("history", () => {
  it("returns newest first inside the range", () => {
    const { store, mem } = openFixture();
    mem.seed("training");
    for (const day of ["2026-09-20", "2026-09-22", "2026-09-21"]) {
      store.log({ what: day, day }, { training: 1 });
    }
    const hist = store.history("training", "2026-09-21", "2026-09-22", 10);
    expect(hist.map((ev) => ev.day)).toEqual(["2026-09-22", "2026-09-21"]);
  });
});

describe("block", () => {
  it("sets and reads a span", () => {
    const { store } = openFixture();
    expect(store.block("climbing")).toBeNull();
    store.setBlock("climbing", "2026-09-01", "2027-02-28");
    expect(store.block("climbing")).toEqual({ area: "climbing", fromDay: "2026-09-01", toDay: "2027-02-28" });
    expect(() => store.setBlock("climbing", "2027-01-01", "2026-01-01")).toThrow(/from 2027-01-01 is after to 2026-01-01/);
  });
});

describe("areas", () => {
  it("skips bootstrap", () => {
    const { store, mem } = openFixture();
    mem.put("aim/bootstrap", "asked");
    mem.seed("training");
    expect(store.areas()).toEqual(["training"]);
  });
});

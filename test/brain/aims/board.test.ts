import { aimsFrame } from "@/brain/aims";
import { describe, expect, it } from "vitest";
import { LA, localInstant, shiftDay, openFixture } from "./fixture";

describe("board", () => {
  it("drops an empty sentence and keeps five days", () => {
    const now = localInstant(LA, 2026, 9, 27, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.put("aim/weight", "lose weight");
    store.log({ what: "weigh", day: "2026-09-27" }, { weight: 1 });
    const board = store.board(["training", "Not Area", "weight"], now);
    expect(board.links).toEqual([]);
    expect(board.aims).toHaveLength(1);
    const row = board.aims[0];
    expect(row?.area).toBe("weight");
    expect(row?.days).toHaveLength(5);
    expect(row?.days[0]?.day).toBe("2026-09-23");
    expect(row?.days[4]?.day).toBe("2026-09-27");
    expect(JSON.stringify(row?.days[0])).toContain(`"events":[]`);
    expect(row?.sentence).toBe("lose weight");
    expect(row?.note).toBe("");
    expect(row?.slope).toBeUndefined();
    expect(row?.weeks).toBeDefined();
  });

  it("omits slope and links for a single week", () => {
    const now = localInstant(LA, 2026, 9, 26, 12, 0);
    const { store, mem } = openFixture(LA, now);
    mem.seed("training");
    store.log({ what: "gym", day: "2026-09-26" }, { training: 2 });
    const board = store.board(["training"], now);
    const body = JSON.stringify(aimsFrame(board));
    expect(board.aims).toHaveLength(1);
    expect(board.aims[0]?.weeks).toHaveLength(1);
    expect(board.aims[0]?.slope).toBeUndefined();
    expect(board.links).toEqual([]);
    expect(body).not.toContain(`"slope"`);
    expect(body).not.toContain(`"links"`);
  });

  it("carries links once nine weeks of next-day scores exist", () => {
    const { store, mem } = openFixture(LA);
    mem.seed("drinking", "climbing");
    for (let w = 0; w < 9; w++) {
      const day = shiftDay("2026-08-02", w * 7);
      const next = shiftDay(day, 1);
      const score = w % 2 === 0 ? 2 : -2;
      store.log({ what: "night", day }, { drinking: score });
      store.log({ what: "session", day: next }, { climbing: score });
    }
    const now = localInstant(LA, 2026, 10, 4, 12, 0);
    const board = store.board(["drinking", "climbing"], now);
    expect(board.aims).toHaveLength(2);
    const drink = board.aims.find((row) => row.area === "drinking");
    expect(drink?.weeks?.length ?? 0).toBeGreaterThanOrEqual(9);
    expect(drink?.slope).toEqual(expect.any(Number));
    expect(board.links.length).toBeGreaterThan(0);
    expect(board.links[0]?.a).toBeTruthy();
    expect(board.links[0]?.n ?? 0).toBeGreaterThanOrEqual(8);
  });
});

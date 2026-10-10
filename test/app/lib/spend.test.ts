import { describe, expect, it } from "vitest";
import {
  browserSpendRate,
  estSpendUsd,
  fmtTokens,
  fmtUsd,
  parseSamples,
  parseSpendRate,
  readSpendRate,
  rollupSamples,
  samplesQuery,
  saveSpendRate,
  SPEND_RATE_KEY,
  windowStart,
  writeSpendRate,
} from "@/app/lib/spend";
import type { SampleRow } from "@/lib/door/settingsStore";

const NOW = Date.UTC(2026, 9, 10, 15, 0, 0);

function row(partial: Partial<SampleRow> & Pick<SampleRow, "at" | "agent" | "kind" | "value">): SampleRow {
  return { id: 1, ...partial };
}

describe("windowStart", () => {
  it("is local midnight today, else a rolling 7 or 30 days", () => {
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    expect(windowStart("today", NOW)).toBe(midnight.getTime());
    expect(windowStart("7d", NOW)).toBe(NOW - 7 * 86_400_000);
    expect(windowStart("30d", NOW)).toBe(NOW - 30 * 86_400_000);
  });
});

describe("money and tokens", () => {
  it("formats tokens the way the board did", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(-1)).toBe("0");
    expect(fmtTokens(Number.NaN)).toBe("0");
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(1000)).toBe("1.00k");
    expect(fmtTokens(9999)).toBe("10.00k");
    expect(fmtTokens(10_000)).toBe("10.0k");
    expect(fmtTokens(1_000_000)).toBe("1.0M");
    expect(fmtTokens(1_500_000)).toBe("1.5M");
  });

  it("formats dollars and skips the estimate until a rate is pasted", () => {
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(-1)).toBe("$0");
    expect(fmtUsd(Number.NaN)).toBe("$0");
    expect(fmtUsd(0.001)).toBe("$0.0010");
    expect(fmtUsd(0.01)).toBe("$0.01");
    expect(fmtUsd(1.2)).toBe("$1.20");
    expect(estSpendUsd(1_000_000, 1_000_000, null)).toBeNull();
    expect(estSpendUsd(2_000_000, 500_000, 4)).toBe(10);
    expect(estSpendUsd(0, 0, 0)).toBe(0);
  });
});

describe("spend rate", () => {
  it("parses a pasted $ / 1M figure", () => {
    expect(parseSpendRate("")).toBeNull();
    expect(parseSpendRate("  ")).toBeNull();
    expect(parseSpendRate("nope")).toBeNull();
    expect(parseSpendRate("-3")).toBeNull();
    expect(parseSpendRate("$2.50")).toBe(2.5);
    expect(parseSpendRate("2.5 / 1M")).toBe(2.5);
    expect(parseSpendRate("1,000")).toBe(1000);
    expect(parseSpendRate("0")).toBe(0);
  });

  it("stores the rate under gantree.spend.rate", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    expect(readSpendRate(null)).toBeNull();
    expect(readSpendRate(storage)).toBeNull();
    writeSpendRate(storage, 2.5);
    expect(store.get(SPEND_RATE_KEY)).toBe("2.5");
    expect(readSpendRate(storage)).toBe(2.5);
    storage.setItem(SPEND_RATE_KEY, "nope");
    expect(readSpendRate(storage)).toBeNull();
    writeSpendRate(storage, null);
    expect(store.has(SPEND_RATE_KEY)).toBe(false);
    writeSpendRate(storage, Number.NaN);
    expect(store.has(SPEND_RATE_KEY)).toBe(false);

    const bare = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    writeSpendRate(bare, -1);
    expect(store.get(SPEND_RATE_KEY)).toBe("");
    expect(readSpendRate(bare)).toBeNull();
  });

  it("reads nothing where there is no window", () => {
    expect(browserSpendRate()).toBeNull();
    saveSpendRate(4);
    saveSpendRate(null);
  });
});

describe("parseSamples", () => {
  it("keeps well-formed rows and drops junk", () => {
    expect(parseSamples(null)).toEqual([]);
    expect(parseSamples({})).toEqual([]);
    expect(parseSamples({ samples: "no" })).toEqual([]);
    expect(parseSamples({ samples: [null, { at: 1 }, { at: 1, agent: "kit", kind: "turn", value: Number.NaN }] })).toEqual([]);
    expect(parseSamples({
      samples: [{ at: 5, agent: "kit", kind: "turn", value: 1 }, { id: 9, at: 6, agent: "ada", kind: "tokens_prompt", value: 3 }],
    })).toEqual([
      { id: 1, at: 5, agent: "kit", kind: "turn", value: 1 },
      { id: 9, at: 6, agent: "ada", kind: "tokens_prompt", value: 3 },
    ]);
  });
});

describe("samplesQuery", () => {
  it("puts since and an optional agent on the query", () => {
    expect(samplesQuery(10.9)).toBe("/api/samples?since=10");
    const url = new URL(samplesQuery(10, "kit"), "https://g.test");
    expect(url.pathname).toBe("/api/samples");
    expect(url.searchParams.get("since")).toBe("10");
    expect(url.searchParams.get("agent")).toBe("kit");
  });
});

describe("rollupSamples", () => {
  const since = windowStart("7d", NOW);

  it("sums prompt, completion, and turns inside the window", () => {
    const roll = rollupSamples([
      row({ id: 1, at: since, agent: "kit", kind: "tokens_prompt", value: 40 }),
      row({ id: 2, at: since, agent: "kit", kind: "tokens_prompt", value: 10 }),
      row({ id: 3, at: since, agent: "kit", kind: "tokens_completion", value: 5 }),
      row({ id: 4, at: since, agent: "kit", kind: "turn", value: 2 }),
      row({ id: 5, at: since - 1, agent: "kit", kind: "tokens_prompt", value: 999 }),
      row({ id: 6, at: since, agent: "ada", kind: "tokens_prompt", value: 50 }),
      row({ id: 7, at: since, agent: "ada", kind: "tokens_prompt", value: 50 }),
      row({ id: 12, at: since, agent: "bee", kind: "tokens_prompt", value: 20 }),
      row({ id: 13, at: since, agent: "ant", kind: "tokens_prompt", value: 20 }),
      row({ id: 8, at: since, agent: "zed", kind: "disk", value: 80 }),
      row({ id: 9, at: since, agent: "zed", kind: "tokens_prompt", value: -3 }),
      row({ id: 10, at: since, agent: "  ", kind: "tokens_prompt", value: 8 }),
      row({ id: 11, at: since, agent: "bob", kind: "turn", value: Number.NaN }),
    ], "7d", 2, NOW);

    expect(roll.since).toBe(since);
    expect(roll.prompt).toBe(190);
    expect(roll.completion).toBe(5);
    expect(roll.turns).toBe(2);
    expect(roll.usd).toBeCloseTo(0.00039);
    expect(roll.agents.map((item) => item.agent)).toEqual(["ada", "kit", "ant", "bee"]);
    expect(roll.agents[1]).toMatchObject({ prompt: 50, completion: 5, turns: 2 });
    expect(roll.agents[1]?.usd).toBeCloseTo(0.00011);
  });

  it("leaves the cost off when no rate is stored", () => {
    const roll = rollupSamples([
      row({ at: NOW, agent: "kit", kind: "tokens_prompt", value: 10 }),
    ], "today", null, NOW);
    expect(roll.usd).toBeNull();
    expect(roll.agents[0]?.usd).toBeNull();
  });

  it("returns an empty rollup when nothing falls in the window", () => {
    const roll = rollupSamples([], "30d", 1, NOW);
    expect(roll.agents).toEqual([]);
    expect(roll.prompt).toBe(0);
    expect(roll.usd).toBe(0);
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { badgeColor, badgeSvg, main, pctFromVitestSummary } from "../../scripts/badge.mjs";

describe("badge inputs", () => {
  it("reads the vitest json-summary total", () => {
    expect(pctFromVitestSummary({ total: { lines: { pct: 87.654 } } })).toBe(87.654);
    expect(() => pctFromVitestSummary({})).toThrow(/total\.lines\.pct/);
    expect(() => pctFromVitestSummary({ total: { lines: { pct: "x" } } })).toThrow();
  });
});

describe("badgeSvg", () => {
  it("bands color like gantree and ai-gantry", () => {
    expect(badgeColor(95)).toBe("#4c1");
    expect(badgeColor(80)).toBe("#4c1");
    expect(badgeColor(79.9)).toBe("#97ca00");
    expect(badgeColor(60)).toBe("#97ca00");
    expect(badgeColor(45)).toBe("#a4a61d");
    expect(badgeColor(10)).toBe("#e05d44");
  });

  it("labels, rounds, and widens for a longer label", () => {
    const app = badgeSvg({ label: "coverage", pct: 86.5 });
    expect(app).toContain('aria-label="coverage: 87%"');
    expect(app).toContain("<title>coverage: 87%</title>");
    expect(app).toContain('fill="#4c1"');
    const wider = badgeSvg({ label: "line coverage", pct: 62 });
    expect(wider).toContain("<title>line coverage: 62%</title>");
    const w = (svg: string): number => {
      const match = /width="(\d+)"/.exec(svg);
      const width = match?.[1];
      if (!width) {
        throw new Error("badge svg has no width");
      }
      return Number(width);
    };
    expect(w(wider)).toBeGreaterThan(w(app));
  });
});

describe("main", () => {
  it("writes an svg from a vitest summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "badge-"));
    const summary = join(dir, "coverage-summary.json");
    writeFileSync(summary, JSON.stringify({ total: { lines: { pct: 91.2 } } }));
    const out = join(dir, "badges", "coverage.svg");
    expect(main(["vitest", summary, out])).toEqual({ pct: 91.2, out });
    expect(readFileSync(out, "utf8")).toContain("coverage: 91%");
  });

  it("refuses a bad kind or missing args", () => {
    expect(() => main(["nope", "a", "b"])).toThrow(/unknown input kind|ENOENT/);
    expect(() => main([])).toThrow(/usage/);
  });
});

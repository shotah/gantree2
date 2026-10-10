import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error scripts/*.mjs sits outside the TS project
import { badgeColor, badgeSvg, main, pctFromGoFunc, pctFromVitestSummary } from "../../scripts/badge.mjs";

describe("badge inputs", () => {
  it("reads the vitest json-summary total", () => {
    expect(pctFromVitestSummary({ total: { lines: { pct: 87.654 } } })).toBe(87.654);
    expect(() => pctFromVitestSummary({})).toThrow(/total\.lines\.pct/);
    expect(() => pctFromVitestSummary({ total: { lines: { pct: "x" } } })).toThrow();
  });

  it("reads the go cover -func total line", () => {
    const text = [
      "github.com/x/harness/internal/agent/run.go:12:\tRun\t\t80.0%",
      "github.com/x/harness/mcp/maps/main.go:4:\tmain\t\t0.0%",
      "total:\t\t\t\t(statements)\t71.3%",
      "",
    ].join("\n");
    expect(pctFromGoFunc(text)).toBe(71.3);
    expect(() => pctFromGoFunc("nothing here")).toThrow(/total/);
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
    const harness = badgeSvg({ label: "harness coverage", pct: 62 });
    expect(harness).toContain("<title>harness coverage: 62%</title>");
    const w = (svg: string) => Number(/width="(\d+)"/.exec(svg)![1]);
    expect(w(harness)).toBeGreaterThan(w(app));
  });
});

describe("main", () => {
  it("writes an svg from a vitest summary and from a go func dump", () => {
    const dir = mkdtempSync(join(tmpdir(), "badge-"));
    const summary = join(dir, "coverage-summary.json");
    writeFileSync(summary, JSON.stringify({ total: { lines: { pct: 91.2 } } }));
    const out = join(dir, "badges", "coverage.svg");
    expect(main(["vitest", summary, out])).toEqual({ pct: 91.2, out });
    expect(readFileSync(out, "utf8")).toContain("coverage: 91%");

    const fn = join(dir, "harness-func.txt");
    writeFileSync(fn, "total:\t(statements)\t58.4%\n");
    const out2 = join(dir, "badges", "harness-coverage.svg");
    expect(main(["gofunc", fn, out2, "harness coverage"]).pct).toBe(58.4);
    expect(readFileSync(out2, "utf8")).toContain("harness coverage: 58%");
    expect(readFileSync(out2, "utf8")).toContain('fill="#a4a61d"');
  });

  it("refuses a bad kind or missing args", () => {
    expect(() => main(["nope", "a", "b"])).toThrow(/unknown input kind|ENOENT/);
    expect(() => main([])).toThrow(/usage/);
  });
});

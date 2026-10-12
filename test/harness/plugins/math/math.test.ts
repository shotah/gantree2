import { describe, expect, it } from "vitest";
import { evaluate, formatFloat, normalizeExpr } from "@/harness/plugins/math/eval";
import { mathPlugin } from "@/harness/plugins/math/index";
import { convert, resolveUnit } from "@/harness/plugins/math/units";
import { callTool, pluginCtx, textOf } from "../helpers";

const cases: { name: string; expr: string; want: number }[] = [
  { name: "add", expr: "2 + 2", want: 4 },
  { name: "precedence", expr: "2 + 3 * 4", want: 14 },
  { name: "parens", expr: "(2 + 3) * 4", want: 20 },
  { name: "power_star", expr: "2 ** 10", want: 1024 },
  { name: "power_caret", expr: "2^10", want: 1024 },
  { name: "sqrt", expr: "sqrt(16)", want: 4 },
  { name: "pow_fn", expr: "pow(2, 8)", want: 256 },
  { name: "pi", expr: "pi", want: Math.PI },
  { name: "e", expr: "e", want: Math.E },
  { name: "phi", expr: "phi", want: (1 + Math.sqrt(5)) / 2 },
  { name: "trig", expr: "sin(pi / 2)", want: 1 },
  { name: "scientific", expr: "1e2 + 3", want: 103 },
  { name: "nested", expr: "sqrt(pow(3, 2) + pow(4, 2))", want: 5 },
  { name: "percentish", expr: "17.5 * 3 / 2", want: 26.25 },
  { name: "percent_of", expr: "17.5% of 240", want: 42 },
  { name: "percent_alone", expr: "50%", want: 0.5 },
  { name: "percent_times", expr: "100 * 17.5%", want: 17.5 },
  { name: "percent_sci_of", expr: "1e2% of 50", want: 50 },
  { name: "modulo_spaced", expr: "10 % 3", want: 1 },
  { name: "abs", expr: "abs(-3)", want: 3 },
  { name: "floor_ceil", expr: "floor(3.9) + ceil(1.1)", want: 5 },
  { name: "round", expr: "round(2.5)", want: 3 },
  { name: "log10", expr: "log10(1000)", want: 3 },
  { name: "min_max", expr: "min(3, 1) + max(2, 9)", want: 10 },
  { name: "deg_rad", expr: "deg(rad(90))", want: 90 },
  { name: "mod", expr: "mod(10, 3)", want: 1 },
  { name: "hypot", expr: "hypot(3, 4)", want: 5 },
];

describe("math evaluate", () => {
  for (const tc of cases) {
    it(tc.name, () => {
      expect(Math.abs(evaluate(tc.expr) - tc.want)).toBeLessThanOrEqual(1e-9);
    });
  }

  it("rejects empty, syntax, and non-finite results", () => {
    for (const expr of ["", "   ", "2 +", "not_a_function(1)", "1 / 0", "sqrt(-1)"]) {
      expect(() => evaluate(expr)).toThrow();
    }
    expect(() => evaluate("")).toThrow("expression is required");
    expect(() => evaluate("2 +")).toThrow(/^invalid expression:/);
    expect(() => evaluate("1 / 0")).toThrow("result is not finite");
  });

  it("rewrites percent of, and leaves spaced modulo alone", () => {
    expect(normalizeExpr("17.5% of 240")).toBe("((17.5)/100)*240");
    expect(normalizeExpr("10 % 3")).toBe("10 % 3");
  });

  it("formats integers and decimals the way Go strconv does", () => {
    expect(formatFloat(4)).toBe("4");
    expect(formatFloat(2.5)).toBe("2.5");
    expect(formatFloat(1e21)).toBe("1e+21");
    expect(formatFloat(1.23e21)).toBe("1.23e+21");
  });
});

describe("math units", () => {
  const conversions: { name: string; value: number; from: string; to: string; want: number; tolerance: number }[] = [
    { name: "miles_to_km", value: 1, from: "mi", to: "km", want: 1.609344, tolerance: 1e-6 },
    { name: "lb_to_kg", value: 220, from: "lb", to: "kg", want: 99.7903216, tolerance: 1e-4 },
    { name: "F_to_C", value: 32, from: "F", to: "C", want: 0, tolerance: 1e-9 },
    { name: "imperial_gallon_to_liter", value: 1, from: "gallon", to: "liter", want: 4.54609, tolerance: 1e-5 },
    { name: "us_gallon_to_liter", value: 1, from: "us_gallon", to: "liter", want: 3.785411784, tolerance: 1e-9 },
    { name: "us_gal_alias", value: 1, from: "us_gal", to: "liter", want: 3.785411784, tolerance: 1e-9 },
    { name: "fluid_gallon", value: 1, from: "fluid gallon", to: "liter", want: 3.785411784, tolerance: 1e-9 },
    { name: "us_gallon_spaced", value: 1, from: "US gallon", to: "liter", want: 3.785411784, tolerance: 1e-9 },
  ];

  for (const tc of conversions) {
    it(tc.name, () => {
      const got = convert(tc.value, tc.from, tc.to);
      expect(Math.abs(got.value - tc.want)).toBeLessThanOrEqual(tc.tolerance);
      expect(got.from).not.toBe("");
      expect(got.to).not.toBe("");
      expect(got.label).not.toBe("");
    });
  }

  it("rejects missing, incompatible, unknown, and non-finite values", () => {
    expect(() => convert(1, "", "km")).toThrow("from and to units are required");
    expect(() => convert(1, "mi", "")).toThrow("from and to units are required");
    expect(() => convert(1, "mi", "kg")).toThrow(/cannot convert mile → kilogram/);
    expect(() => convert(1, "nope", "km")).toThrow(/unknown from unit "nope"/);
    expect(() => convert(Number.NaN, "mi", "km")).toThrow("value must be a finite number");
    expect(() => convert(Number.POSITIVE_INFINITY, "mi", "km")).toThrow("value must be a finite number");
  });

  it("keeps bare gallon imperial and maps us_gallon to fluid gallon", () => {
    expect(resolveUnit("us_gallon")).toBe("fluid gallon");
    expect(resolveUnit("gallon")).toBe("gallon");
  });
});

describe("math plugin", () => {
  it("publishes both tools with no key and matches the Go schemas", async () => {
    const ctx = pluginCtx();
    expect(mathPlugin.name).toBe("math");
    expect(await mathPlugin.ready(ctx)).toBeNull();
    const tools = mathPlugin.tools(ctx);
    expect(tools.map((t) => t.name)).toEqual(["expression_evaluate", "units_convert"]);
    expect(tools[0]?.description.startsWith("Evaluate a mathematical expression")).toBe(true);
    expect(tools[0]?.inputSchema).toMatchObject({
      type: "object",
      required: ["expression"],
      additionalProperties: false,
    });
    expect(tools[1]?.description).toContain("us_gallon/us_gal/fluid gallon = US liquid");
    expect(tools[1]?.inputSchema).toMatchObject({
      type: "object",
      required: ["value", "from", "to"],
      additionalProperties: false,
    });
  });

  it("evaluates 2^10 as result_text 1024", async () => {
    const result = await callTool(mathPlugin, pluginCtx(), "expression_evaluate", { expression: "2^10" });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toMatchObject([{ expression: "2^10", result: 1024, result_text: "1024" }]);
  });

  it("returns a row error for a broken expression and keeps the good one", async () => {
    const result = await callTool(mathPlugin, pluginCtx(), "expression_evaluate", { expressions: ["2+2", "1/"] });
    expect(result.isError).toBeUndefined();
    const rows = JSON.parse(textOf(result)) as { expression: string; result?: number; error?: string }[];
    expect(rows[0]).toMatchObject({ expression: "2+2", result: 4 });
    expect(rows[1]?.error).toMatch(/invalid expression/);
  });

  it("converts 32 F to 0 C", async () => {
    const result = await callTool(mathPlugin, pluginCtx(), "units_convert", { value: 32, from: "F", to: "C" });
    expect(result.isError).toBeUndefined();
    const got = JSON.parse(textOf(result)) as { result: number; result_text: string; label: string }[];
    expect(got[0]?.result).toBe(0);
    expect(got[0]?.result_text).toBe("0");
    expect(got[0]?.label).not.toBe("");
  });

  it("returns a row error for incompatible units and converts the rest", async () => {
    const result = await callTool(mathPlugin, pluginCtx(), "units_convert", {
      conversions: [
        { value: 1, from: "mi", to: "kg" },
        { value: 1, from: "mi", to: "km" },
      ],
    });
    expect(result.isError).toBeUndefined();
    const rows = JSON.parse(textOf(result)) as { error?: string; result?: number }[];
    expect(rows[0]?.error).toContain("cannot convert");
    expect(rows[1]?.result).toBeGreaterThan(1);
  });
});

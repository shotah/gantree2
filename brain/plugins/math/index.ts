import type { JsonSchema, Plugin, Tool } from "@/brain/core/tools";
import { errorResult, textResult } from "@/brain/core/tools";
import { evaluate, formatFloat } from "./eval";
import { convert } from "./units";

const maxMath = 20;

const evaluateDescription = "Evaluate a mathematical expression and return the numeric result. "
  + "Use this for any arithmetic beyond trivial mental math — do not guess. "
  + "Supports + - * / % ** (or ^ for power), parentheses, scientific notation, "
  + "percentages (17.5% of 240, 50%, 100*17.5%), constants pi/e/phi, and functions: "
  + "abs, sqrt, pow, sin, cos, tan, asin, acos, atan, atan2, "
  + "log, log10, log2, exp, floor, ceil, round, trunc, min, max, mod, hypot, sinh, cosh, tanh, "
  + "deg (radians→degrees), rad (degrees→radians). Angles for trig are in radians. "
  + "Modulo needs spaces around % (10 % 3) or use mod(10, 3). "
  + "expressions accepts up to 20. expression still works for one. A bad expression is an error row.";

const convertDescription = "Convert a numeric value between units (length, mass, temperature, volume, etc.). "
  + "Examples: 5 mi→km, 220 lb→kg, 32 F→C, 1 us_gallon→liter. "
  + "Use common unit names or symbols (mi, km, lb, kg, F, C, liter). "
  + "Volume: gallon/gal = imperial (UK, 4.54609 L); us_gallon/us_gal/fluid gallon = US liquid (3.785411784 L). "
  + "conversions accepts up to 20 objects {value, from, to}. value, from, and to still work for one. A bad conversion is an error row.";

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

function goJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[&<>\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case "&": return "\\u0026";
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "\u2028": return "\\u2028";
      default: return "\\u2029";
    }
  });
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export const mathPlugin: Plugin = {
  name: "math",
  ready: () => Promise.resolve(null),
  tools(): Tool[] {
    return [
      {
        name: "expression_evaluate",
        description: evaluateDescription,
        inputSchema: objectSchema({
          expression: {
            type: "string",
            description: "Mathematical expression to evaluate, e.g. (17.5 * 3) / 2 or sqrt(2^10)",
          },
          expressions: {
            type: "array",
            description: "Expressions to evaluate together (max 20). expression still works for one.",
            items: { type: "string" },
          },
        }, ["expression"]),
        call: (args) => {
          const expressions = typeof args.expression === "string" ? [args.expression] : [];
          for (const item of stringList(args.expressions)) {
            if (!expressions.includes(item)) expressions.push(item);
          }
          if (expressions.length === 0) return Promise.resolve(errorResult("expression is required"));
          if (expressions.length > maxMath) return Promise.resolve(errorResult("expressions accepts at most 20"));
          const rows = expressions.map((expression) => {
            try {
              const result = evaluate(expression);
              return { expression, result, result_text: formatFloat(result) };
            } catch (err) {
              return { expression, error: err instanceof Error ? err.message : "invalid expression" };
            }
          });
          return Promise.resolve(textResult(goJSON(rows)));
        },
      },
      {
        name: "units_convert",
        description: convertDescription,
        inputSchema: objectSchema({
          value: { type: "number", description: "Numeric value to convert" },
          from: { type: "string", description: "Source unit name or symbol (e.g. mi, lb, F)" },
          to: { type: "string", description: "Target unit name or symbol (e.g. km, kg, C)" },
          conversions: {
            type: "array",
            description: "Conversions to run together (max 20). Each object has value, from, and to. The flat value/from/to fields still convert one.",
            items: { type: "object" },
          },
        }, ["value", "from", "to"]),
        call: (args) => {
          const jobs: { value: unknown; from: string; to: string }[] = [];
          if (Array.isArray(args.conversions) && args.conversions.length > 0) {
            for (const item of args.conversions) {
              if (!isRecord(item)) {
                jobs.push({ value: undefined, from: "", to: "" });
                continue;
              }
              jobs.push({ value: item.value, from: asString(item.from), to: asString(item.to) });
            }
          } else {
            jobs.push({ value: args.value, from: asString(args.from), to: asString(args.to) });
          }
          if (jobs.length > maxMath) return Promise.resolve(errorResult("conversions accepts at most 20"));
          const rows = jobs.map((job) => {
            const value = asNumber(job.value);
            if (value === undefined) {
              return { value: job.value, from: job.from, to: job.to, error: "value must be a finite number" };
            }
            try {
              const out = convert(value, job.from, job.to);
              return {
                value,
                from: out.from,
                to: out.to,
                result: out.value,
                result_text: formatFloat(out.value),
                label: out.label,
              };
            } catch (err) {
              return {
                value,
                from: job.from,
                to: job.to,
                error: err instanceof Error ? err.message : "cannot convert",
              };
            }
          });
          return Promise.resolve(textResult(goJSON(rows)));
        },
      },
    ];
  },
};

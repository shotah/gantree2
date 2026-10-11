import type { JsonSchema } from "@/brain/core/tools";
import { DAY_CAP } from "./dates";

export type SchemaProp = {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required?: boolean;
  items?: "string" | "number";
};

export const DATES_NOTE = `Pass date, dates, or inclusive start/end (max ${DAY_CAP} days) for several days in one call; omit for today. Returns a list.`;
export const RANGE_NOTE = `Pass start/end, date, or dates (max ${DAY_CAP} days) for the window; omit for the last 7 days. Returns a list.`;
export const ID_CAP = 20;
export const IDS_NOTE = `Pass activity_id or ids (max ${ID_CAP}) to fetch several in one call. Returns a list.`;

/** mcp-go WithString/WithNumber object schema (description then type; required only when set). */
export function toolSchema(props: SchemaProp[]): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  // encoding/json sorts map keys; required stays in registration order.
  const ordered = [...props].sort((a, b) => a.name < b.name ? -1 : 1);
  for (const prop of ordered) {
    properties[prop.name] = prop.type === "array"
      ? { description: prop.description, items: { type: prop.items ?? "string" }, type: "array" }
      : { description: prop.description, type: prop.type };
  }
  for (const prop of props) {
    if (prop.required) required.push(prop.name);
  }
  if (required.length > 0) return { properties, required, type: "object" };
  return { properties, type: "object" };
}

export const emptySchema: JsonSchema = { properties: {}, type: "object" };

/** mcp-go date-range option, plus date/dates. Start/end descriptions stay the Go text. */
export function dateRangeSchema(): JsonSchema {
  return toolSchema([
    { description: dateDescription("One calendar day"), name: "date", type: "string" },
    { description: `Calendar days to fetch together (YYYY-MM-DD, max ${DAY_CAP})`, items: "string", name: "dates", type: "array" },
    { description: "End date (YYYY-MM-DD)", name: "end", type: "string" },
    { description: "Start date (YYYY-MM-DD)", name: "start", type: "string" },
  ]);
}

/** `date` plus `dates` / inclusive `start`/`end` (max {@link DAY_CAP} days). */
export function dayProps(dateText: string): SchemaProp[] {
  return [
    { description: dateDescription(dateText), name: "date", type: "string" },
    { description: `Calendar days to fetch together (YYYY-MM-DD, max ${DAY_CAP})`, items: "string", name: "dates", type: "array" },
    { description: `Inclusive end (YYYY-MM-DD). Span with start is at most ${DAY_CAP} days.`, name: "end", type: "string" },
    { description: `Inclusive start (YYYY-MM-DD). Span with end is at most ${DAY_CAP} days.`, name: "start", type: "string" },
  ];
}

export function idProps(single: string): SchemaProp[] {
  return [
    { description: single, name: "activity_id", type: "number" },
    { description: `Activity ids to fetch together (max ${ID_CAP}). activity_id is also accepted.`, items: "number", name: "ids", type: "array" },
  ];
}

export function dateDescription(description: string): string {
  if (description.toLowerCase().includes("yyyy-mm-dd")) return description;
  return `${description} (YYYY-MM-DD)`;
}

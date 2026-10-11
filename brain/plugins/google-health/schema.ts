import type { JsonSchema } from "@/brain/core/tools";

type Prop = { type: "string" | "integer" | "array"; description: string; items?: { type: "string" } };

function objectSchema(properties: Record<string, Prop>, required?: string[]): JsonSchema {
  const encoded: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    encoded[key] = prop.type === "array"
      ? { description: prop.description, items: prop.items ?? { type: "string" }, type: "array" }
      : { description: prop.description, type: prop.type };
  }
  const schema: JsonSchema = {
    type: "object",
    properties: encoded,
    additionalProperties: false,
  };
  if (required !== undefined && required.length > 0) {
    schema.required = required;
  }
  return schema;
}

const str = (description: string): Prop => ({ type: "string", description });
const int = (description: string): Prop => ({ type: "integer", description });
const strs = (description: string): Prop => ({ type: "array", description, items: { type: "string" } });

const dayFields = {
  start: str("Inclusive start YYYY-MM-DD. Span with end is at most 31 days."),
  end: str("Inclusive end YYYY-MM-DD. Span with start is at most 31 days."),
  dates: strs("YYYY-MM-DD days to fetch together (max 31)."),
};

export const emptyInputSchema: JsonSchema = { type: "object", additionalProperties: false };

export const SLEEP_GET_DESCRIPTION = "Get Google Health sleep sessions (Fitbit / Pixel Watch) via reconcile. "
  + "Omit dates for last night (wake-up day is today). "
  + "For several nights pass after_date (inclusive) and before_date (exclusive) once — do not call once per day. "
  + "Read sessions[]: duration_minutes, efficiency, stages_minutes, minutes_to_fall_asleep, minutes_awake. "
  + "The Google Health app Sleep Score (0-100) is not in the API; do not invent one. "
  + "efficiency is round(minutes asleep / minutes in the sleep period * 100). "
  + "Also accepts start/end (inclusive) or dates (max 31 days); omit for today. Returns one object per day.";

export const ACTIVITIES_LIST_DESCRIPTION = "List recent Google Health exercises (dataTypes/exercise) in a date window. "
  + "Call this first for “what did I do?”, then activities_get for detail. "
  + "Pass after_date and before_date once for the whole window. "
  + "Exercise pages are 25; if next_page_token is set, call again with page_token. "
  + "Bound days in the human’s timezone.";

export const ACTIVITIES_GET_DESCRIPTION = "Get one exercise data point by id/name from activities_list. "
  + "Use after the human (or list tool) picks a log. "
  + "Pass activity_id or ids (max 20) to fetch several in one call. Returns a list.";

export const HEART_RATE_DESCRIPTION = "Get daily resting heart rate from Google Health. "
  + "Omit date for today. For a span, pass after_date (inclusive) and before_date (exclusive) once and read entries[] — do not call once per day. "
  + "Use with sleep_get and hrv_get for recovery. "
  + "Also accepts start/end (inclusive) or dates (max 31 days); omit for today. Returns one object per day.";

export const HRV_DESCRIPTION = "Get daily heart-rate variability when the wearable recorded it. "
  + "Omit date for today. For a span, pass after_date (inclusive) and before_date (exclusive) once and read entries[] — do not call once per day. "
  + "Also accepts start/end (inclusive) or dates (max 31 days). Returns one object per day.";

export const WEIGHT_DESCRIPTION = "Get weight logs from Google Health for a period. "
  + "Use for scale trends — not for inventing weigh-ins. "
  + "Also accepts start/end (inclusive) or dates (max 31 days); omit for today. period is capped at 31 days. Returns one object per day.";

export const PROFILE_DESCRIPTION = "Get Google Health identity / profile (display name, Fitbit + Google ids). "
  + "Useful to confirm which account is connected.";

export const ACCOUNT_DESCRIPTION = "Check Google Health auth / token status without running a data query when possible. "
  + "If unauthenticated, tell the human to run google-health-mcp auth or gantry auth ghealth.";

export const sleepGetSchema = objectSchema({
  date: str("One wake-up day YYYY-MM-DD. Omit for last night. Ignored when after_date or before_date is set."),
  after_date: str("Inclusive wake-up day YYYY-MM-DD. Use with before_date to fetch many nights in one call."),
  before_date: str("Exclusive wake-up day YYYY-MM-DD end bound."),
  ...dayFields,
});

export const activitiesListSchema = objectSchema({
  after_date: str("YYYY-MM-DD start (inclusive) in human timezone"),
  before_date: str("YYYY-MM-DD end bound"),
  limit: int("Max activities (default 20)"),
  page_token: str("Pagination token from a prior list"),
});

export const activitiesGetSchema = objectSchema({
  activity_id: str("Exercise data point id/name from activities_list"),
  ids: strs("Exercise data point ids/names (max 20). activity_id is also accepted."),
});

export const heartRateSchema = objectSchema({
  date: str("YYYY-MM-DD (default today). Ignored when after_date or before_date is set."),
  after_date: str("Inclusive start YYYY-MM-DD. One call for the whole span."),
  before_date: str("Exclusive end YYYY-MM-DD."),
  ...dayFields,
});

export const hrvSchema = objectSchema({
  date: str("YYYY-MM-DD (default today). Ignored when after_date or before_date is set."),
  after_date: str("Inclusive start YYYY-MM-DD. One call for the whole span."),
  before_date: str("Exclusive end YYYY-MM-DD."),
  ...dayFields,
});

export const weightSchema = objectSchema({
  base_date: str("YYYY-MM-DD end of window"),
  period: str("e.g. 1m or 7d. Capped at 31 days."),
  date: str("One YYYY-MM-DD. Omit for today unless base_date or period is set."),
  ...dayFields,
});

export const TOOL_NAMES = [
  "sleep_get",
  "activities_list",
  "activities_get",
  "heart_rate_get",
  "hrv_get",
  "weight_get",
  "profile_get",
  "account_get",
] as const;

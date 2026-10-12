import type { PluginContext, Tool } from "@/harness/core/tools";
import { optionalInt, resolveActivityIds } from "./args";
import { mapPool, FETCH_CAP } from "./batch";
import { toListItem } from "./climb";
import { apiGet } from "./http";
import { errorMessage, GarminError, parseJson, projectText, type Shape } from "./json";
import { tool, toolCall } from "./run";
import { IDS_NOTE, idProps, toolSchema } from "./schema";
import { activityDetailShape, activityDetailsShape, splitSummariesShape, typedSplitsShape } from "./shapes";
import { publishesExtended } from "./tier";

const LIST = "List recent Garmin activities (runs, rides, climbs, etc.) with pagination; returns a list of activity_id for follow-ups. "
  + "Use for 'what did I do', 'workouts this week', activity history. "
  + "Climbing list items may include falls/sends; per-route grades need activities_get_typed_splits; session fall totals need activities_get_split_summaries.";

const GET = "Detailed summary for one activity by activity_id from activities_list: metadata, distance/time/HR, and overview splits. "
  + "Use when the user asks about a specific workout. For climbing per-route grades use activities_get_typed_splits; for fall/send aggregates use activities_get_split_summaries.";

const DETAILS = "Extended time-series metrics for an activity_id (samples over the workout). "
  + "Use when you need charts/samples beyond activities_get's summary. Prefer activities_get first for a normal workout recap.";

const TYPED = "Typed splits for an activity_id. For indoor climbing/bouldering: per-route CLIMB_ACTIVE|CLIMB_REST, "
  + "status CLIMB_COMPLETED|CLIMB_ATTEMPTED, gradeValue (VERMIN/YDS/FONT). "
  + "Use for 'what grades did I climb', sends vs attempts. Session fall totals are on activities_get_split_summaries (numFalls).";

const SUMMARIES = "Split summaries aggregated by type for an activity_id. For climbing CLIMB_ACTIVE: numFalls (watch falls), "
  + "numClimbSends, numClimbsCompleted, maxGradeValue. Use for session fall/send totals; "
  + "use activities_get_typed_splits for per-route grades/status.";

async function eachActivity(
  ctx: PluginContext,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  path: (id: number) => string,
  shape: Shape,
): Promise<unknown[]> {
  const ids = resolveActivityIds(args);
  return mapPool(ids, FETCH_CAP, async (id) => {
    try {
      const text = await apiGet(ctx, path(id), signal);
      return projectText(text, shape);
    } catch (err) {
      return { activity_id: id, error: errorMessage(err) };
    }
  });
}

function listQuery(args: Record<string, unknown>): string {
  const startArg = optionalInt(args, "start") ?? 0;
  let limitArg = optionalInt(args, "limit") ?? 0;
  if (limitArg === 0) limitArg = 20;
  const start = startArg > 0 ? startArg : 0;
  let limit = limitArg > 0 ? limitArg : 20;
  if (limit > 100) limit = 100;
  return `start=${String(start)}&limit=${String(limit)}`;
}

export function activityTools(ctx: PluginContext): Tool[] {
  const tools: Tool[] = [
    tool({
      description: LIST,
      inputSchema: toolSchema([
        { description: "Starting index (0-based, defaults to 0)", name: "start", type: "number" },
        { description: "Maximum number of activities to return (defaults to 20, max 100)", name: "limit", type: "number" },
      ]),
      name: "activities_list",
    }, (args, call) => toolCall(async () => {
      const text = await apiGet(
        ctx,
        `/activitylist-service/activities/search/activities?${listQuery(args)}`,
        call.signal,
        { notFound: false },
      );
      const parsed = parseJson(text);
      if (!Array.isArray(parsed)) throw new GarminError("json: cannot unmarshal into Go value of type []garmin.Activity");
      return parsed.map((row) => toListItem(row));
    })),
    tool({
      description: `${GET} ${IDS_NOTE}`,
      inputSchema: toolSchema(idProps("The activity ID")),
      name: "activities_get",
    }, (args, call) => toolCall(() => eachActivity(
      ctx,
      args,
      call.signal,
      (id) => `/activity-service/activity/${String(id)}`,
      activityDetailShape,
    ))),
  ];
  if (publishesExtended(ctx.env)) {
    tools.push(tool({
      description: `${DETAILS} ${IDS_NOTE}`,
      inputSchema: toolSchema(idProps("The activity ID")),
      name: "activities_get_details",
    }, (args, call) => toolCall(() => eachActivity(
      ctx,
      args,
      call.signal,
      (id) => `/activity-service/activity/${String(id)}/details`,
      activityDetailsShape,
    ))));
  }
  tools.push(
    tool({
      description: `${TYPED} ${IDS_NOTE}`,
      inputSchema: toolSchema(idProps("The activity ID")),
      name: "activities_get_typed_splits",
    }, (args, call) => toolCall(() => eachActivity(
      ctx,
      args,
      call.signal,
      (id) => `/activity-service/activity/${String(id)}/typedsplits`,
      typedSplitsShape,
    ))),
    tool({
      description: `${SUMMARIES} ${IDS_NOTE}`,
      inputSchema: toolSchema(idProps("The activity ID")),
      name: "activities_get_split_summaries",
    }, (args, call) => toolCall(() => eachActivity(
      ctx,
      args,
      call.signal,
      (id) => `/activity-service/activity/${String(id)}/split_summaries`,
      splitSummariesShape,
    ))),
  );
  return tools;
}

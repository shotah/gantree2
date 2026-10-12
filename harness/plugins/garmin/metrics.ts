import type { PluginContext, Tool } from "@/harness/core/tools";
import { eachDay } from "./batch";
import { resolveDayList } from "./dates";
import { apiGet } from "./http";
import { GarminError, isRecord, parseJson, projectNamedList, projectText } from "./json";
import { tool, toolCall } from "./run";
import { DATES_NOTE, dayProps, toolSchema } from "./schema";
import { maxMetShape, readinessEntryShape, trainingStatusAggregatedShape } from "./shapes";
import { publishesExtended } from "./tier";

const DATE = "Calendar day for readiness (YYYY-MM-DD, defaults to today)";

const DESCRIPTION = "Garmin Training Readiness score plus contributing factors (sleep, recovery time, HRV, acute load, etc.). "
  + "Use for 'am I recovered enough to train', 'readiness', 'should I rest or push'. "
  + "For overnight sleep detail use sleep_get; for Body Battery events use wellness_get_body_battery.";

const VO2_DATE = "Calendar day for VO2 max snapshot (YYYY-MM-DD, defaults to today)";
const VO2 = "Latest VO2 max / MET values (generic and cycling when present). Use for 'VO2 max', 'cardio fitness'. "
  + "Not training readiness (metrics_get_training_readiness) and not race predictions (metrics_get_race_predictions).";

const STATUS_DATE = "Calendar day for training status (YYYY-MM-DD, defaults to today)";
const STATUS = "Aggregated training status: load balance, VO2 context, heat/altitude acclimation. "
  + "Use for 'training status', 'am I overreaching', load overview. For recover-or-push today prefer metrics_get_training_readiness.";

export function metricsTools(ctx: PluginContext): Tool[] {
  const tools: Tool[] = [
    tool({
      description: `${DESCRIPTION} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(DATE)),
      name: "metrics_get_training_readiness",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/metrics-service/metrics/trainingreadiness/${date}`, call.signal);
      return projectNamedList(text, "Entries", readinessEntryShape);
    }))),
  ];
  if (!publishesExtended(ctx.env)) return tools;
  tools.push(
    tool({
      description: `${VO2} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(VO2_DATE)),
      name: "metrics_get_vo_two_max",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/metrics-service/metrics/maxmet/latest/${date}`, call.signal);
      return projectText(text, maxMetShape);
    }))),
    tool({
      description: `${STATUS} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(STATUS_DATE)),
      name: "metrics_get_training_status",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/metrics-service/metrics/trainingstatus/aggregated/${date}`, call.signal);
      return projectText(text, trainingStatusAggregatedShape);
    }))),
  );
  return tools;
}

export async function resolveDisplayName(ctx: PluginContext, override: string, signal?: AbortSignal): Promise<string> {
  if (override !== "") return override;
  try {
    const text = await apiGet(ctx, "/userprofile-service/socialProfile", signal);
    const parsed = parseJson(text);
    const name = isRecord(parsed) && typeof parsed.displayName === "string" ? parsed.displayName : "";
    if (name === "") throw new GarminError("social profile has empty display name");
    return name;
  } catch (err) {
    if (err instanceof GarminError && err.message === "social profile has empty display name") throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new GarminError(`failed to get display name: ${message}`);
  }
}

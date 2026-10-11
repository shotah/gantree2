import type { PluginContext, Tool } from "@/brain/core/tools";
import { eachDay } from "./batch";
import { resolveDayList } from "./dates";
import { apiGet } from "./http";
import { projectText } from "./json";
import { tool, toolCall } from "./run";
import { DATES_NOTE, dayProps, toolSchema } from "./schema";
import { dailyHrvShape } from "./shapes";

const DATE = "Calendar day for HRV status (YYYY-MM-DD, defaults to today; overnight HRV is attributed to the wake-up day)";

const DESCRIPTION = "Heart-rate variability for a day: overnight average, weekly average, and baseline range. "
  + "Use for 'HRV', 'recovery', 'nervous system readiness'. Pair with sleep_get / metrics_get_training_readiness for coaching. "
  + "Not a sleep score — use sleep_get for sleep quality.";

export function hrvTools(ctx: PluginContext): Tool[] {
  return [
    tool({
      description: `${DESCRIPTION} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(DATE)),
      name: "hrv_get",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/hrv-service/hrv/${date}`, call.signal);
      return projectText(text, dailyHrvShape);
    }))),
  ];
}

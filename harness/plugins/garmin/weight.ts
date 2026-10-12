import type { PluginContext, Tool } from "@/harness/core/tools";
import { eachDay } from "./batch";
import { resolveDayList } from "./dates";
import { apiGet } from "./http";
import { projectText } from "./json";
import { tool, toolCall } from "./run";
import { DATES_NOTE, dayProps, toolSchema } from "./schema";
import { dailyWeightShape } from "./shapes";

const DATE = "Weigh-in calendar day (YYYY-MM-DD, defaults to today)";

const DESCRIPTION = "Index/scale weigh-in for a day: weight, BMI, body fat %, muscle mass, bone mass, body water. "
  + "Use for 'what's my weight', 'body composition', 'scale reading'. Not for steps, sleep, or activities.";

export function weightTools(ctx: PluginContext): Tool[] {
  return [
    tool({
      description: `${DESCRIPTION} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(DATE)),
      name: "weight_get",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/weight-service/weight/dayview/${date}`, call.signal);
      return projectText(text, dailyWeightShape);
    }))),
  ];
}

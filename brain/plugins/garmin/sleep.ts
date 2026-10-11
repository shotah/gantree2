import type { PluginContext, Tool } from "@/brain/core/tools";
import { eachDay } from "./batch";
import { resolveDayList } from "./dates";
import { apiGet } from "./http";
import { projectText } from "./json";
import { tool, toolCall } from "./run";
import { DATES_NOTE, dayProps, toolSchema } from "./schema";
import { dailySleepShape } from "./shapes";

const DATE = "Wake-up calendar day (YYYY-MM-DD). CRITICAL: 'last night' / 'this morning' = TODAY "
  + "(or omit). Example: if today is 2026-07-28, pass 2026-07-28 — NOT 2026-07-27. Defaults to today.";

const DESCRIPTION = "ONLY tool for overnight sleep / sleep score / 'how did I sleep' / 'last night' / sleep history. "
  + "Returns score, duration, deep/light/REM, awake time. Call immediately — do not narrate, do not use wellness_get_body_battery. "
  + "For 'last night', omit date or pass today (wake-up day). Prefer over wellness_get_sleep.";

export function sleepTools(ctx: PluginContext): Tool[] {
  return [
    tool({
      description: `${DESCRIPTION} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(DATE)),
      name: "sleep_get",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/sleep-service/sleep/dailySleepData?date=${date}`, call.signal);
      return projectText(text, dailySleepShape);
    }))),
  ];
}

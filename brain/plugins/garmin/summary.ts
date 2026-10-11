import type { PluginContext, Tool } from "@/brain/core/tools";
import { optionalString } from "./args";
import { eachDay } from "./batch";
import { resolveDayList } from "./dates";
import { apiGet } from "./http";
import { projectText } from "./json";
import { resolveDisplayName } from "./metrics";
import { tool, toolCall } from "./run";
import { DATES_NOTE, dayProps, toolSchema } from "./schema";
import { dailySummaryShape } from "./shapes";
import { publishesExtended } from "./tier";

const DESCRIPTION = "Connect home-screen daily totals: steps, calories, distance, floors, intensity, stress, Body Battery snapshot. "
  + "Use for 'how active was I today', steps/calories overview. Prefer sleep_get for overnight sleep and weight_get for scale readings.";

export function summaryTools(ctx: PluginContext): Tool[] {
  if (!publishesExtended(ctx.env)) return [];
  return [
    tool({
      description: `${DESCRIPTION} ${DATES_NOTE}`,
      inputSchema: toolSchema([
        ...dayProps("Calendar day for the home-screen summary (YYYY-MM-DD, defaults to today)"),
        { description: "User display name (defaults to current user)", name: "display_name", type: "string" },
      ]),
      name: "summary_get_daily",
    }, (args, call) => toolCall(async () => {
      const dates = resolveDayList(args, ctx.clock);
      const displayName = await resolveDisplayName(ctx, optionalString(args, "display_name"), call.signal);
      return eachDay(dates, async (date) => {
        const text = await apiGet(
          ctx,
          `/usersummary-service/usersummary/daily/${displayName}?calendarDate=${date}`,
          call.signal,
        );
        return projectText(text, dailySummaryShape);
      });
    })),
  ];
}

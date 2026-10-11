import type { PluginContext, Tool } from "@/brain/core/tools";
import { formatRfc3339, monthName, todayYmd, weekdayName } from "./dates";
import { localParts } from "@/brain/core/clock";
import { emptySchema } from "./schema";
import { tool, toolCall } from "./run";

const DESCRIPTION = "Returns today's local date (YYYY-MM-DD), weekday, and ISO timestamp. "
  + "Use when you need an explicit date before calling dated Garmin tools; "
  + "most tools already default date=today so you can often skip this.";

export function utilityTools(ctx: PluginContext): Tool[] {
  return [
    tool({
      description: DESCRIPTION,
      inputSchema: emptySchema,
      name: "utility_get_current_date",
      single: "one local clock reading for the human's zone",
    }, () => toolCall(() => {
      const ms = ctx.clock.now();
      const zone = ctx.clock.zone;
      const parts = localParts(ms, zone);
      return {
        date: todayYmd(ctx.clock),
        day: parts.day,
        iso8601: formatRfc3339(ms, zone),
        month: parts.month,
        month_name: monthName(ms, zone),
        weekday: weekdayName(ms, zone),
        year: parts.year,
      };
    })),
  ];
}

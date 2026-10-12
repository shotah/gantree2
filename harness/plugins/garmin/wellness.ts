import type { Clock } from "@/harness/core/clock";
import type { PluginContext, Tool } from "@/harness/core/tools";
import { eachDay } from "./batch";
import { inclusiveDays, resolveDayList, resolveRange } from "./dates";
import { apiGet } from "./http";
import { isRecord, projectNamedList, projectText } from "./json";
import { tool, toolCall } from "./run";
import { DATES_NOTE, RANGE_NOTE, dateRangeSchema, dayProps, toolSchema } from "./schema";
import { bodyBatteryEventShape, bodyBatteryReportShape, dailyHeartRateShape, dailyIntensityShape, dailyStressShape, sleepScoreEntryShape } from "./shapes";
import { publishesExtended } from "./tier";

const BATTERY_DATE = "Calendar day for Body Battery events (YYYY-MM-DD, defaults to today)";
const BATTERY = "NOT for sleep score / 'how did I sleep' / last night — use sleep_get for that. "
  + "Body Battery charge/drain events for one day (energy timeline). "
  + "Use only for 'body battery', 'energy level', 'am I drained'. "
  + "Multi-day totals: wellness_get_body_battery_reports.";

const STRESS_DATE = "Calendar day for stress (YYYY-MM-DD, defaults to today)";
const STRESS = "Intraday stress levels for one day (max, average, chart). Use for 'stress today', 'how stressed was I'. "
  + "Not Body Battery (wellness_get_body_battery) and not overnight HRV (hrv_get).";

const HR_DATE = "Calendar day for heart rate (YYYY-MM-DD, defaults to today)";
const HR = "All-day heart rate for a date: resting HR, max HR, time in zones. Use for 'resting heart rate', 'HR today'. "
  + "Not HRV (hrv_get) and not per-activity HR zones (activities_get_hr_zones).";

const IM_DATE = "Anchor day for weekly intensity minutes (YYYY-MM-DD, defaults to today)";
const IM = "Moderate + vigorous intensity minutes and progress toward the weekly goal (as of the given day). "
  + "Use for 'intensity minutes', 'am I hitting my activity goal'. Not a workout list — use activities_list for that.";

const REPORTS = "Daily Body Battery charged/drained totals over a date range (default last 7 days). "
  + "Use for weekly energy trends. For today's event timeline use wellness_get_body_battery. "
  + RANGE_NOTE;

const SCORES = "Daily sleep scores only over a date range (default last 7 days) — no stages/duration detail. "
  + "Use for 'sleep score this week'. For last night's full sleep (stages, duration, score) use sleep_get. "
  + RANGE_NOTE;

function filled(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Range tools keep the Go default (end=today, start=end−7) unless date/dates is set. */
function reportSpan(args: Record<string, unknown>, clock: Clock): { start: string; end: string } {
  const hasDate = filled(args.date) || (Array.isArray(args.dates) && args.dates.length > 0);
  if (!hasDate) {
    const range = resolveRange(args, clock);
    if (range.start <= range.end) inclusiveDays(range.start, range.end);
    return range;
  }
  const days = resolveDayList(args, clock);
  const sorted = [...days].sort();
  const start = sorted[0] ?? resolveRange(args, clock).start;
  const end = sorted[sorted.length - 1] ?? start;
  inclusiveDays(start, end);
  return { start, end };
}

function rangeRows(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const list = value.Reports ?? value.Entries;
  if (!Array.isArray(list)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    if (typeof item.date === "string" && item.date !== "") {
      rows.push(item);
      continue;
    }
    if (typeof item.calendarDate === "string" && item.calendarDate !== "") {
      rows.push({ ...item, date: item.calendarDate });
      continue;
    }
    rows.push(item);
  }
  return rows;
}

export function wellnessTools(ctx: PluginContext): Tool[] {
  const extended = publishesExtended(ctx.env);
  const tools: Tool[] = [];
  if (extended) {
    tools.push(tool({
      description: `${STRESS} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(STRESS_DATE)),
      name: "wellness_get_stress",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/wellness-service/wellness/dailyStress/${date}`, call.signal);
      return projectText(text, dailyStressShape);
    }))));
  }
  tools.push(tool({
    description: `${BATTERY} ${DATES_NOTE}`,
    inputSchema: toolSchema(dayProps(BATTERY_DATE)),
    name: "wellness_get_body_battery",
  }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
    const text = await apiGet(ctx, `/wellness-service/wellness/bodyBattery/events/${date}`, call.signal);
    return projectNamedList(text, "Events", bodyBatteryEventShape);
  }))));
  if (!extended) return tools;
  tools.push(
    tool({
      description: `${HR} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(HR_DATE)),
      name: "wellness_get_heart_rate",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/wellness-service/wellness/dailyHeartRate/?date=${date}`, call.signal);
      return projectText(text, dailyHeartRateShape);
    }))),
    tool({
      description: `${IM} ${DATES_NOTE}`,
      inputSchema: toolSchema(dayProps(IM_DATE)),
      name: "wellness_get_intensity_minutes",
    }, (args, call) => toolCall(async () => eachDay(resolveDayList(args, ctx.clock), async (date) => {
      const text = await apiGet(ctx, `/wellness-service/wellness/daily/im/${date}`, call.signal);
      return projectText(text, dailyIntensityShape);
    }))),
    tool({
      description: REPORTS,
      inputSchema: dateRangeSchema(),
      name: "wellness_get_body_battery_reports",
    }, (args, call) => toolCall(async () => {
      const range = reportSpan(args, ctx.clock);
      const text = await apiGet(
        ctx,
        `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${range.start}&endDate=${range.end}`,
        call.signal,
      );
      return rangeRows(projectNamedList(text, "Reports", bodyBatteryReportShape));
    })),
    tool({
      description: SCORES,
      inputSchema: dateRangeSchema(),
      name: "wellness_get_sleep_score_stats",
    }, (args, call) => toolCall(async () => {
      const range = reportSpan(args, ctx.clock);
      const text = await apiGet(
        ctx,
        `/wellness-service/stats/daily/sleep/score/${range.start}/${range.end}`,
        call.signal,
      );
      return rangeRows(projectNamedList(text, "Entries", sleepScoreEntryShape));
    })),
  );
  return tools;
}

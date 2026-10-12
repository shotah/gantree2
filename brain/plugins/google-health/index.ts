import { errorResult, textResult, type CallContext, type Plugin, type PluginContext, type Tool, type ToolResult } from "@/brain/core/tools";
import {
  accountStatus,
  activitiesGet,
  activitiesList,
  healthClient,
  heartRateGet,
  hrvGet,
  profileGet,
  sleepGet,
  weightGet,
  type HealthClient,
} from "@/brain/plugins/google-health/client";
import {
  activitiesListJSON,
  activityJSON,
  heartRateListJSON,
  hrvListJSON,
  profileJSON,
  sleepListJSON,
  weightJSON,
} from "@/brain/plugins/google-health/parse";
import {
  ACCOUNT_DESCRIPTION,
  ACTIVITIES_GET_DESCRIPTION,
  ACTIVITIES_LIST_DESCRIPTION,
  activitiesGetSchema,
  activitiesListSchema,
  emptyInputSchema,
  HEART_RATE_DESCRIPTION,
  heartRateSchema,
  HRV_DESCRIPTION,
  hrvSchema,
  PROFILE_DESCRIPTION,
  SLEEP_GET_DESCRIPTION,
  sleepGetSchema,
  WEIGHT_DESCRIPTION,
  weightSchema,
} from "@/brain/plugins/google-health/schema";
import { addDays, civilString, DAY_CAP, expandInclusive, parseCivilDate, resolveHealthDays, todayCivil, weightPeriodDays } from "@/brain/plugins/google-health/civil";
import { goJSON } from "@/brain/plugins/google-health/wire";

export { keys } from "./keys";

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function argInt(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return 0;
}

function envTrim(env: Readonly<Record<string, string>>, key: string): string {
  const value: unknown = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function openClient(ctx: PluginContext, call: CallContext): HealthClient {
  return healthClient({
    clientId: envTrim(ctx.env, "GOOGLE_HEALTH_CLIENT_ID"),
    clientSecret: envTrim(ctx.env, "GOOGLE_HEALTH_CLIENT_SECRET"),
    baseURL: envTrim(ctx.env, "GOOGLE_HEALTH_BASE_URL"),
    fetch: ctx.fetch,
    signal: call.signal,
    clock: ctx.clock,
    tokens: ctx.tokens,
  });
}

const FETCH_CAP = 4;
const ID_CAP = 20;

async function mapPool<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.min(FETCH_CAP, items.length);
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await fn(item);
    }
  }
  if (workers === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

function dayArgsSet(args: Record<string, unknown>): boolean {
  if (Array.isArray(args.dates) && args.dates.length > 0) return true;
  for (const key of ["date", "start", "end", "after_date", "before_date"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") return true;
  }
  return false;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "google health request failed";
}

async function eachDay(
  ctx: PluginContext,
  call: CallContext,
  args: Record<string, unknown>,
  load: (client: HealthClient, date: string) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const days = resolveHealthDays(args, ctx.clock.now(), ctx.clock.zone);
  const client = openClient(ctx, call);
  return mapPool(days, async (date) => {
    try {
      return { date, ...await load(client, date) };
    } catch (err) {
      return { date, error: errorText(err) };
    }
  });
}

function resolveActivityIds(args: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const one = argString(args, "activity_id").trim();
  if (one !== "") ids.push(one);
  if (Object.hasOwn(args, "ids") && args.ids != null) {
    if (!Array.isArray(args.ids)) throw new Error("ids must be a list of activity ids");
    for (const item of args.ids) {
      if (typeof item !== "string" || item.trim() === "") throw new Error("ids must be a list of activity ids");
      ids.push(item.trim());
    }
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) throw new Error("activity_id is required");
  if (unique.length > ID_CAP) throw new Error(`ids accepts at most ${ID_CAP} activities`);
  return unique;
}

async function callTool(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return textResult(goJSON(await run()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "google health request failed";
    return errorResult(message);
  }
}

export const googleHealth: Plugin = {
  name: "google-health",
  async ready(ctx) {
    if (envTrim(ctx.env, "GOOGLE_HEALTH_CLIENT_ID") === "" || envTrim(ctx.env, "GOOGLE_HEALTH_CLIENT_SECRET") === "") {
      return "no_key";
    }
    const token = await ctx.tokens.get("google");
    if ((token?.accessToken ?? "").trim() === "") {
      return "no_oauth";
    }
    return null;
  },
  tools(ctx) {
    const sleep: Tool = {
      name: "sleep_get",
      description: SLEEP_GET_DESCRIPTION,
      inputSchema: sleepGetSchema,
      call: (args, call) => callTool(() => eachDay(ctx, call, args, async (client, date) => sleepListJSON(await sleepGet(client, date, "", "")))),
    };
    const activities: Tool = {
      name: "activities_list",
      description: ACTIVITIES_LIST_DESCRIPTION,
      inputSchema: activitiesListSchema,
      call: (args, call) => callTool(async () => activitiesListJSON(await activitiesList(
        openClient(ctx, call),
        argString(args, "after_date"),
        argString(args, "before_date"),
        argInt(args, "limit"),
        argString(args, "page_token"),
      ))),
    };
    const activity: Tool = {
      name: "activities_get",
      description: ACTIVITIES_GET_DESCRIPTION,
      inputSchema: activitiesGetSchema,
      call: (args, call) => callTool(async () => {
        const ids = resolveActivityIds(args);
        const client = openClient(ctx, call);
        return mapPool(ids, async (id) => {
          try {
            return activityJSON(await activitiesGet(client, id));
          } catch (err) {
            return { activity_id: id, error: errorText(err) };
          }
        });
      }),
    };
    const heart: Tool = {
      name: "heart_rate_get",
      description: HEART_RATE_DESCRIPTION,
      inputSchema: heartRateSchema,
      call: (args, call) => callTool(() => eachDay(ctx, call, args, async (client, date) => heartRateListJSON(await heartRateGet(client, date, "", "")))),
    };
    const hrv: Tool = {
      name: "hrv_get",
      description: HRV_DESCRIPTION,
      inputSchema: hrvSchema,
      call: (args, call) => callTool(() => eachDay(ctx, call, args, async (client, date) => hrvListJSON(await hrvGet(client, date, "", "")))),
    };
    const weight: Tool = {
      name: "weight_get",
      description: WEIGHT_DESCRIPTION,
      inputSchema: weightSchema,
      call: (args, call) => callTool(async () => {
        if (!dayArgsSet(args) && (argString(args, "base_date") !== "" || argString(args, "period") !== "")) {
          const period = argString(args, "period");
          const span = weightPeriodDays(period);
          if (span > DAY_CAP) throw new Error(`date span exceeds ${DAY_CAP} days`);
          const end = argString(args, "base_date") || civilString(todayCivil(ctx.clock.now(), ctx.clock.zone));
          const start = civilString(addDays(parseCivilDate(end), -span));
          const days = expandInclusive(start, end);
          const result = await weightGet(openClient(ctx, call), argString(args, "base_date"), period);
          const byDate = new Map<string, Record<string, unknown>[]>();
          for (const entry of result.entries) {
            const stamped = typeof entry.date === "string" ? entry.date : "";
            const list = byDate.get(stamped) ?? [];
            list.push(entry);
            byDate.set(stamped, list);
          }
          return days.map((date) => {
            const entries = byDate.get(date) ?? [];
            return { date, ...weightJSON(entries, result.note) };
          });
        }
        return eachDay(ctx, call, args, async (client, date) => {
          const result = await weightGet(client, date, "1d");
          const entries = result.entries.filter((entry) => entry.date === date);
          return weightJSON(entries, result.note);
        });
      }),
    };
    const profile: Tool = {
      name: "profile_get",
      description: PROFILE_DESCRIPTION,
      inputSchema: emptyInputSchema,
      single: "one Google Health profile",
      call: (_args, call) => callTool(async () => profileJSON(await profileGet(openClient(ctx, call)))),
    };
    const account: Tool = {
      name: "account_get",
      description: ACCOUNT_DESCRIPTION,
      inputSchema: emptyInputSchema,
      single: "one Google Health account",
      call: (_args, call) => callTool(async () => accountStatus(openClient(ctx, call))),
    };
    return [sleep, activities, activity, heart, hrv, weight, profile, account];
  },
};

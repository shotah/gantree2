import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink } from "@/brain/core";
import type { CallContext, OAuthToken, PluginContext, TokenStore, ToolResult } from "@/brain/core/tools";
import {
  addDays,
  filterDailyDate,
  filterDailyWindow,
  filterDaySession,
  filterSessionRange,
  filterSleepWindow,
  filterWeightPeriod,
  parseDurationSeconds,
} from "@/brain/plugins/google-health/civil";
import {
  accountStatus,
  activitiesGet,
  activitiesList,
  dataPointsURL,
  defaultBaseURL,
  googleTokenURL,
  healthClient,
  heartRateGet,
  hrvGet,
  profileGet,
  sleepGet,
  wearablesFamily,
  weightGet,
} from "@/brain/plugins/google-health/client";
import { googleHealth } from "@/brain/plugins/google-health";
import { ACCOUNT_DESCRIPTION, TOOL_NAMES } from "@/brain/plugins/google-health/schema";

const call: CallContext = { userId: "u", sessionId: "s" };
const aug3 = Date.UTC(2026, 7, 3, 15, 0, 0);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function routeFetch(handler: (url: URL, init?: RequestInit) => Response): typeof fetch {
  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(new URL(href), init));
  };
}

function headerValue(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  if (headers === undefined || Array.isArray(headers)) {
    const pair = Array.isArray(headers) ? headers.find(([key]) => key.toLowerCase() === name.toLowerCase()) : undefined;
    return pair?.[1] ?? "";
  }
  return headers[name] ?? "";
}

function memoryTokens(initial: OAuthToken | null): TokenStore & { read(): OAuthToken | null } {
  let current = initial;
  return {
    get: () => Promise.resolve(current),
    put: (_provider, token) => {
      current = token;
      return Promise.resolve();
    },
    delete: () => {
      current = null;
      return Promise.resolve();
    },
    read: () => current,
  };
}

function pluginCtx(
  env: Record<string, string>,
  fetchFn: typeof fetch,
  token: OAuthToken | null,
  at = aug3,
): PluginContext & { tokens: TokenStore & { read(): OAuthToken | null } } {
  const tokens = memoryTokens(token);
  return {
    env,
    sql: { exec: () => [], one: () => null, changes: () => 0 },
    clock: fixedClock(at, "UTC"),
    log: makeLogger(memorySink(), () => at),
    fetch: fetchFn,
    tokens,
  };
}

function textOf(result: ToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

const authed = { accessToken: "test-token" };
const creds = { GOOGLE_HEALTH_CLIENT_ID: "cid", GOOGLE_HEALTH_CLIENT_SECRET: "sec" };

function snakeTool(name: string): boolean {
  const parts = name.split("_");
  const head = parts[0] ?? "";
  return parts.length >= 2 && /^[a-z]+$/.test(head) && parts.slice(1).every((part) => /^[a-z0-9]+$/.test(part));
}

describe("google-health plugin", () => {
  it("publishes the Go tool list and auth gates", async () => {
    const ctx = pluginCtx(creds, routeFetch(() => jsonResponse({})), authed);
    expect(googleHealth.name).toBe("google-health");
    const tools = googleHealth.tools(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const name of tools.map((tool) => tool.name)) {
      expect(name.startsWith("ghealth_") || name.startsWith("health_") || name.startsWith("google_")).toBe(false);
      expect(snakeTool(name)).toBe(true);
    }
    expect(tools[0]?.description.startsWith("Get Google Health sleep sessions")).toBe(true);
    expect(tools[0]?.inputSchema.required).toBeUndefined();
    expect(tools.find((tool) => tool.name === "activities_get")?.inputSchema.required).toBeUndefined();
    expect(tools.find((tool) => tool.name === "activities_get")?.inputSchema.properties).toMatchObject({ ids: { type: "array" } });
    expect(tools.find((tool) => tool.name === "account_get")?.single).toContain("account");
    expect(tools.find((tool) => tool.name === "profile_get")?.single).toContain("profile");
    expect(tools.find((tool) => tool.name === "account_get")?.description).toBe(ACCOUNT_DESCRIPTION);
    expect(tools.find((tool) => tool.name === "account_get")?.inputSchema).toEqual({ type: "object", additionalProperties: false });
    expect(await googleHealth.ready(pluginCtx({}, ctx.fetch, authed))).toBe("no_key");
    expect(await googleHealth.ready(pluginCtx({ GOOGLE_HEALTH_CLIENT_ID: "cid" }, ctx.fetch, authed))).toBe("no_key");
    expect(await googleHealth.ready(pluginCtx(creds, ctx.fetch, null))).toBe("no_oauth");
    expect(await googleHealth.ready(pluginCtx(creds, ctx.fetch, { accessToken: "tok", expiresAt: aug3 - 60_000 }))).toBeNull();
  });

  it("builds civil filters from the injected clock", () => {
    const day = filterDaySession("sleep", "2026-08-03", aug3, "UTC");
    expect(day.day).toEqual({ year: 2026, month: 8, day: 3 });
    expect(day.filter).toContain("civil_end_time >= \"2026-08-03\"");
    expect(day.filter).toContain("civil_end_time < \"2026-08-04\"");
    expect(filterDaySession("sleep", "", aug3, "UTC").day).toEqual({ year: 2026, month: 8, day: 3 });
    expect(filterSessionRange("exercise", "", "", aug3, "UTC")).toContain("civil_start_time");
    const daily = filterDailyDate("daily_resting_heart_rate", "2026-08-01", aug3, "UTC");
    expect(daily.filter).toContain("date(2026, 8, 1)");
    const span = filterSleepWindow("", "2026-08-01", "2026-08-08", Date.UTC(2026, 7, 10), "UTC");
    expect(span).toContain("civil_end_time >= \"2026-08-01\"");
    expect(span).toContain("civil_end_time < \"2026-08-08\"");
    expect(() => filterSleepWindow("", "2026-08-08", "2026-08-01", aug3, "UTC")).toThrow(/before_date/);
    const hr = filterDailyWindow("daily_resting_heart_rate", "", "2026-08-01", "2026-08-08", Date.UTC(2026, 7, 10), "UTC");
    expect(hr).toContain("date(2026, 8, 1)");
    expect(hr).toContain("date(2026, 8, 8)");
    expect(filterDailyWindow("daily_heart_rate_variability", "2026-08-03", "", "", aug3, "UTC")).toContain("date = date(2026, 8, 3)");
    expect(filterWeightPeriod("2026-08-03", "1m", aug3, "UTC")).toContain("weight.sample_time.civil_time.date");
    expect(() => filterWeightPeriod("", "nope", aug3, "UTC")).toThrow(/unsupported weight period "nope"/);
    expect(parseDurationSeconds("3600s")).toBe(3600);
    expect(parseDurationSeconds("3.5s")).toBe(3.5);
    expect(addDays({ year: 2026, month: 8, day: 31 }, 1)).toEqual({ year: 2026, month: 9, day: 1 });
    expect(dataPointsURL(defaultBaseURL, "sleep", "reconcile")).toBe("https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile");
  });

  it("reconciles sleep, including pages and a real sleep score", async () => {
    let rangeCalls = 0;
    const fetchFn = routeFetch((url, init) => {
      expect(url.pathname).toContain("/dataTypes/sleep/dataPoints:reconcile");
      expect(url.searchParams.get("dataSourceFamily")).toBe(wearablesFamily);
      expect(headerValue(init, "Authorization")).toBe("Bearer test-token");
      if (url.searchParams.get("filter")?.includes("2026-08-01") === true) {
        expect(url.searchParams.get("filter")).toContain("civil_end_time >= \"2026-08-01\"");
        expect(url.searchParams.get("filter")).toContain("civil_end_time < \"2026-08-04\"");
        rangeCalls += 1;
        if (rangeCalls === 1) {
          return jsonResponse({
            nextPageToken: "page-2",
            dataPoints: [{
              dataPointName: "users/me/dataTypes/sleep/dataPoints/nap",
              sleep: {
                interval: {
                  endTime: "2026-08-02T18:00:00Z",
                  civilEndTime: { date: { year: 2026, month: 8, day: 2 } },
                },
                metadata: { nap: true },
                summary: { minutesAsleep: "40", minutesInSleepPeriod: "45" },
              },
            }],
          });
        }
        expect(url.searchParams.get("pageToken")).toBe("page-2");
        return jsonResponse({
          dataPoints: [{
            dataPointName: "users/me/dataTypes/sleep/dataPoints/main",
            sleep: {
              interval: {
                endTime: "2026-08-03T14:00:00Z",
                civilEndTime: { date: { year: 2026, month: 8, day: 3 } },
              },
              metadata: { mainSleep: true },
              summary: { minutesAsleep: "400", minutesInSleepPeriod: "450", sleepScore: "81" },
            },
          }],
        });
      }
      expect(url.searchParams.get("pageSize")).toBe("25");
      return jsonResponse({
        dataPoints: [{
          name: "users/me/dataTypes/sleep/dataPoints/abc",
          sleep: {
            interval: { startTime: "2026-08-02T22:00:00Z", endTime: "2026-08-03T06:00:00Z" },
            metadata: { mainSleep: true, processed: true },
            summary: {
              minutesAsleep: "420",
              minutesInSleepPeriod: "480",
              minutesAwake: "60",
              minutesToFallAsleep: "12",
              stagesSummary: [
                { type: "DEEP", minutes: "90" },
                { type: "LIGHT", minutes: "210" },
                { type: "REM", minutes: "120" },
                { type: "AWAKE", minutes: "60" },
              ],
            },
          },
        }],
      });
    });
    const ctx = pluginCtx({ ...creds, GOOGLE_HEALTH_BASE_URL: "https://health.test/" }, fetchFn, authed);
    const client = healthClient({
      ...creds,
      clientId: "cid",
      clientSecret: "sec",
      baseURL: "https://health.test/",
      fetch: fetchFn,
      clock: ctx.clock,
      tokens: ctx.tokens,
    });
    expect(client.baseURL).toBe("https://health.test");
    const one = await sleepGet(client, "2026-08-03", "", "");
    expect(one.count).toBe(1);
    expect(one.sessions[0]?.durationMinutes).toBe(420);
    expect(one.sessions[0]?.main).toBe(true);
    expect(one.sessions[0]?.efficiency).toBe(88);
    expect(one.sessions[0]?.stagesMinutes?.deep).toBe(90);
    expect(one.sessions[0]?.minutesToFallAsleep).toBe(12);
    expect(one.sessions[0]?.sleepScore).toBeNull();
    expect(one.note).toContain("does not return the app Sleep Score");
    const span = await sleepGet(client, "", "2026-08-01", "2026-08-04");
    expect(span.count).toBe(2);
    expect(span.sessions[0]?.date).toBe("2026-08-02");
    expect(span.sessions[0]?.nap).toBe(true);
    expect(span.sessions[0]?.main).toBe(false);
    expect(span.sessions[1]?.date).toBe("2026-08-03");
    expect(span.sessions[1]?.sleepScore).toBe(81);
    const tool = await googleHealth.tools(ctx).find((item) => item.name === "sleep_get")?.call({ date: "2026-08-03" }, call);
    expect(tool?.isError).toBeUndefined();
    const body = textOf(tool ?? { content: [] });
    expect(body).toContain("\"efficiency\":88");
    expect(body.indexOf("\"awake\"")).toBeLessThan(body.indexOf("\"deep\""));
  });

  it("sorts daily heart rate and HRV and reports empty windows", async () => {
    const fetchFn = routeFetch((url) => {
      const filter = url.searchParams.get("filter") ?? "";
      const ranged = filter.includes("date(2026, 8, 1)");
      if (ranged) {
        expect(filter).toContain("date >= date(2026, 8, 1)");
        expect(filter).toContain("date < date(2026, 8, 4)");
      }
      if (url.pathname.includes("daily-resting-heart-rate")) {
        if (!ranged) {
          return jsonResponse({ dataPoints: [] });
        }
        return jsonResponse({
          dataPoints: [
            { dailyRestingHeartRate: { date: { year: 2026, month: 8, day: 3 }, beatsPerMinute: "55" } },
            { dailyRestingHeartRate: { date: { year: 2026, month: 8, day: 1 }, beatsPerMinute: "52" } },
          ],
        });
      }
      if (!ranged) {
        return jsonResponse({ dataPoints: [] });
      }
      return jsonResponse({
        dataPoints: [
          { dailyHeartRateVariability: { date: { year: 2026, month: 8, day: 2 }, averageHeartRateVariabilityMilliseconds: 40 } },
          { dailyHeartRateVariability: { date: { year: 2026, month: 8, day: 1 }, deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 38 } },
        ],
      });
    });
    const ctx = pluginCtx({ ...creds, GOOGLE_HEALTH_BASE_URL: "https://health.test" }, fetchFn, authed);
    const client = healthClient({ clientId: "cid", clientSecret: "sec", baseURL: "https://health.test", fetch: fetchFn, clock: ctx.clock, tokens: ctx.tokens });
    const hr = await heartRateGet(client, "", "2026-08-01", "2026-08-04");
    expect(hr.count).toBe(2);
    expect(hr.entries[0]?.date).toBe("2026-08-01");
    expect(hr.entries[0]?.restingHr).toBe(52);
    expect(hr.entries[1]?.restingHr).toBe(55);
    const hrv = await hrvGet(client, "", "2026-08-01", "2026-08-04");
    expect(hrv.entries[0]?.rmssd).toBe(38);
    expect(hrv.entries[1]?.rmssd).toBe(40);
    const one = await heartRateGet(client, "2026-08-03", "", "");
    expect(one.count).toBe(0);
    expect(one.note).toContain("no daily");
    const emptyHrv = await hrvGet(client, "2026-08-03", "", "");
    expect(emptyHrv.note).toContain("no daily");
  });

  it("lists and gets activities, weight, and profile", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.includes("dataPoints:reconcile") && url.pathname.includes("exercise")) {
        expect(url.searchParams.get("pageSize")).toBe("10");
        return jsonResponse({
          dataPoints: [{
            name: "users/me/dataTypes/exercise/dataPoints/ex1",
            exercise: {
              displayName: "Walk",
              exerciseType: "WALKING",
              activeDuration: "1800s",
              interval: { startTime: "2026-08-03T10:00:00Z" },
              metricsSummary: { caloriesKcal: 120, steps: "2500", distanceMillimeters: 2_000_000 },
            },
          }],
        });
      }
      if (url.pathname.includes("/dataPoints/ex1")) {
        return jsonResponse({
          name: "users/me/dataTypes/exercise/dataPoints/ex1",
          exercise: {
            displayName: "Walk",
            exerciseType: "WALKING",
            activeDuration: "1800s",
            interval: { startTime: "2026-08-03T10:00:00Z" },
            metricsSummary: { caloriesKcal: 120 },
          },
        });
      }
      if (url.pathname.includes("/identity")) {
        return jsonResponse({ legacyUserId: "FITBIT1", healthUserId: "G123" });
      }
      if (url.pathname.includes("dataTypes/weight")) {
        expect(url.searchParams.get("dataSourceFamily")).toBeNull();
        return jsonResponse({
          dataPoints: [{
            name: "users/me/dataTypes/weight/dataPoints/w1",
            weight: {
              weightGrams: 82000,
              sampleTime: {
                physicalTime: "2026-08-03T08:00:00Z",
                civilTime: { date: { year: 2026, month: 8, day: 3 } },
              },
            },
          }],
        });
      }
      return jsonResponse({ dataPoints: [] });
    });
    const ctx = pluginCtx({ ...creds, GOOGLE_HEALTH_BASE_URL: "https://health.test" }, fetchFn, authed);
    const client = healthClient({ clientId: "cid", clientSecret: "sec", baseURL: "https://health.test", fetch: fetchFn, clock: ctx.clock, tokens: ctx.tokens });
    const list = await activitiesList(client, "2026-08-01", "2026-08-04", 10, "");
    expect(list.count).toBe(1);
    expect(list.activities[0]?.name).toBe("Walk");
    expect(list.activities[0]?.durationMin).toBe(30);
    expect(list.activities[0]?.distanceKm).toBe(2);
    const got = await activitiesGet(client, "ex1");
    expect(got.name).toBe("Walk");
    const weight = await weightGet(client, "", "1m");
    expect(weight.entries).toHaveLength(1);
    expect(weight.entries[0]?.weight_kg).toBe(82);
    expect(weight.entries[0]?.date).toBe("2026-08-03");
    expect(Object.keys(weight.entries[0] ?? {})[0]).toBe("data_point_name");
    const profile = await profileGet(client);
    expect(profile.fitbitUser).toBe("FITBIT1");
    expect(profile.googleUser).toBe("G123");
    const missing = await googleHealth.tools(ctx).find((tool) => tool.name === "activities_get")?.call({}, call);
    expect(missing?.isError).toBe(true);
    expect(textOf(missing ?? { content: [] })).toBe("activity_id is required");
  });

  it("reports API errors, missing auth, and account status without a token file", async () => {
    const denied = pluginCtx({ ...creds, GOOGLE_HEALTH_BASE_URL: "https://health.test" }, routeFetch(() => jsonResponse("{\"error\":\"nope\"}", 401)), authed);
    const deniedClient = healthClient({ clientId: "cid", clientSecret: "sec", baseURL: "https://health.test", fetch: denied.fetch, clock: denied.clock, tokens: denied.tokens });
    await expect(sleepGet(deniedClient, "2026-08-03", "", "")).rejects.toThrow(/google health API 401/);
    let hits = 0;
    const quiet = pluginCtx(creds, () => {
      hits += 1;
      return Promise.resolve(jsonResponse({}));
    }, null);
    const quietClient = healthClient({ clientId: "cid", clientSecret: "sec", fetch: quiet.fetch, clock: quiet.clock, tokens: quiet.tokens });
    await expect(sleepGet(quietClient, "", "", "")).rejects.toThrow(/google health auth required/);
    expect(hits).toBe(0);
    const status = await accountStatus(quietClient);
    expect(status.authenticated).toBe(false);
    expect(status.provider).toBe("Google Health API");
    expect(status.token_path).toBe("");
    const live = healthClient({
      clientId: "cid",
      clientSecret: "sec",
      fetch: quiet.fetch,
      clock: quiet.clock,
      tokens: memoryTokens({ accessToken: "tok", refreshToken: "r" }),
    });
    const liveStatus = await accountStatus(live);
    expect(liveStatus.authenticated).toBe(true);
    expect(liveStatus.implementation).toBe("live health.googleapis.com/v4 reconcile");
    expect(liveStatus.has_refresh_token).toBe(true);
    expect(liveStatus.client_id_set).toBe(true);
    const tool = await googleHealth.tools(quiet).find((item) => item.name === "account_get")?.call({}, call);
    expect(textOf(tool ?? { content: [] }).startsWith("{\"authenticated\":")).toBe(true);
    const boom = await googleHealth.tools(denied).find((item) => item.name === "sleep_get")?.call({ date: "2026-08-03" }, call);
    expect(boom?.isError).toBeUndefined();
    const boomRows = JSON.parse(textOf(boom ?? { content: [] })) as { date: string; error: string }[];
    expect(boomRows[0]?.date).toBe("2026-08-03");
    expect(boomRows[0]?.error).toContain("401");
  });

  it("refreshes an expired Google token and writes it back", async () => {
    const now = aug3;
    const tokens = memoryTokens({
      accessToken: "old",
      refreshToken: "keep-me",
      expiresAt: now - 1000,
      scope: "sleep",
      extra: { account: "fitbit" },
    });
    let tokenCalls = 0;
    let healthAuth = "";
    const fetchFn = routeFetch((url, init) => {
      if (url.href === googleTokenURL) {
        tokenCalls += 1;
        const raw = typeof init?.body === "string" ? init.body : "";
        expect(raw).toContain("grant_type=refresh_token");
        expect(raw).toContain("refresh_token=keep-me");
        expect(raw).toContain("client_id=cid");
        expect(headerValue(init, "Authorization")).toBe("");
        return jsonResponse({ access_token: "fresh", expires_in: 3600, token_type: "Bearer" });
      }
      if (healthAuth === "") {
        healthAuth = headerValue(init, "Authorization");
      }
      return jsonResponse({ dataPoints: [] });
    });
    const ctx = pluginCtx({ ...creds, GOOGLE_HEALTH_CLIENT_SECRET: "sec" }, fetchFn, null, now);
    const client = healthClient({
      clientId: "cid",
      clientSecret: "sec",
      baseURL: "https://health.test",
      fetch: fetchFn,
      clock: ctx.clock,
      tokens,
    });
    const hr = await heartRateGet(client, "2026-08-03", "", "");
    expect(hr.count).toBe(0);
    expect(tokenCalls).toBe(1);
    expect(healthAuth).toBe("Bearer fresh");
    const saved = tokens.read();
    expect(saved?.accessToken).toBe("fresh");
    expect(saved?.refreshToken).toBe("keep-me");
    expect(saved?.expiresAt).toBe(now + 3_600_000);
    expect(saved?.scope).toBe("sleep");
    expect(saved?.extra).toEqual({ account: "fitbit" });
    const stillValid = healthClient({
      clientId: "cid",
      clientSecret: "sec",
      baseURL: "https://health.test",
      fetch: fetchFn,
      clock: ctx.clock,
      tokens: memoryTokens({ accessToken: "manual" }),
    });
    const before = tokenCalls;
    await heartRateGet(stillValid, "2026-08-03", "", "");
    expect(tokenCalls).toBe(before);
    const expired = healthClient({
      clientId: "cid",
      clientSecret: "sec",
      fetch: fetchFn,
      clock: ctx.clock,
      tokens: memoryTokens({ accessToken: "old", expiresAt: now - 1 }),
    });
    await expect(heartRateGet(expired, "2026-08-03", "", "")).rejects.toThrow(/no refresh_token/);
    const refreshOnly = healthClient({
      clientId: "cid",
      clientSecret: "sec",
      fetch: fetchFn,
      clock: ctx.clock,
      tokens: memoryTokens({ accessToken: "", refreshToken: "only" }),
    });
    await expect(heartRateGet(refreshOnly, "2026-08-03", "", "")).rejects.toThrow(/auth required/);
    const noCreds = healthClient({
      fetch: fetchFn,
      clock: ctx.clock,
      tokens: memoryTokens({ accessToken: "old", refreshToken: "keep-me", expiresAt: now - 1 }),
    });
    await expect(heartRateGet(noCreds, "2026-08-03", "", "")).rejects.toThrow(/GOOGLE_HEALTH_CLIENT_ID\/SECRET required/);
  });

  it("sleep_get, heart_rate_get, hrv_get, and weight_get fetch an inclusive range", async () => {
    const filters: string[] = [];
    const fetchFn = routeFetch((url) => {
      filters.push(url.searchParams.get("filter") ?? "");
      if (url.pathname.includes("/sleep/")) {
        return jsonResponse({ dataPoints: [] });
      }
      if (url.pathname.includes("daily-resting-heart-rate") || url.pathname.includes("daily-heart-rate-variability")) {
        return jsonResponse({ dataPoints: [] });
      }
      return jsonResponse({ dataPoints: [] });
    });
    const ctx = pluginCtx({ ...creds, GOOGLE_HEALTH_BASE_URL: "https://health.test" }, fetchFn, authed);
    const tools = googleHealth.tools(ctx);
    const sleep = JSON.parse(textOf(await tools.find((tool) => tool.name === "sleep_get")?.call({ end: "2026-08-03", start: "2026-08-01" }, call) ?? { content: [] })) as { date: string }[];
    expect(sleep.map((row) => row.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    const listed = JSON.parse(textOf(await tools.find((tool) => tool.name === "hrv_get")?.call({ dates: ["2026-08-01", "2026-08-03"] }, call) ?? { content: [] })) as { date: string }[];
    expect(listed.map((row) => row.date)).toEqual(["2026-08-01", "2026-08-03"]);
    const heart = JSON.parse(textOf(await tools.find((tool) => tool.name === "heart_rate_get")?.call({ date: "2026-08-02" }, call) ?? { content: [] })) as { date: string }[];
    expect(heart).toHaveLength(1);
    expect(heart[0]?.date).toBe("2026-08-02");
    const weight = JSON.parse(textOf(await tools.find((tool) => tool.name === "weight_get")?.call({ end: "2026-08-02", start: "2026-08-01" }, call) ?? { content: [] })) as { date: string }[];
    expect(weight.map((row) => row.date)).toEqual(["2026-08-01", "2026-08-02"]);
    const capped = await tools.find((tool) => tool.name === "sleep_get")?.call({ end: "2026-09-05", start: "2026-08-01" }, call);
    expect(capped?.isError).toBe(true);
    expect(textOf(capped ?? { content: [] })).toContain("date span exceeds 31 days");
    expect(filters.some((filter) => filter.includes("2026-08-01"))).toBe(true);
  });

  it("activities_get accepts ids and still accepts activity_id", async () => {
    const fetchFn = routeFetch((url) => jsonResponse({
      name: url.pathname,
      exercise: { displayName: "Walk", exerciseType: "WALKING", activeDuration: "60s" },
    }));
    const ctx = pluginCtx({ ...creds, GOOGLE_HEALTH_BASE_URL: "https://health.test" }, fetchFn, authed);
    const tool = googleHealth.tools(ctx).find((item) => item.name === "activities_get");
    const many = JSON.parse(textOf(await tool?.call({ ids: ["ex1", "ex2"] }, call) ?? { content: [] })) as { id: string }[];
    expect(many).toHaveLength(2);
    const one = JSON.parse(textOf(await tool?.call({ activity_id: "ex9" }, call) ?? { content: [] })) as { id: string }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.id).toContain("ex9");
  });
});

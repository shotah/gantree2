import { describe, expect, it } from "vitest";
import type { PluginContext, Tool } from "@/brain/core/tools";
import { garmin } from "@/brain/plugins/garmin";
import { isExpired, type Session } from "@/brain/plugins/garmin/http";
import { goJSON } from "@/brain/plugins/garmin/json";
import { AUTH_GUIDE_URL } from "@/brain/plugins/garmin/sso";
import { authed, bodyText, call, header, jsonResponse, jwt, makeCtx, NOW, scripted, textOf } from "./harness";

const extendedEnv = {
  GARMIN_EMAIL: "ada@example.com",
  GARMIN_PASSWORD: "secret",
  GARMIN_TOOL_TIER: "extended",
};

const access = jwt({ client_id: "from-jwt", exp: 1893456000 });
const tokenBody = JSON.stringify({
  access_token: access,
  expires_in: 3600,
  refresh_token: "rotated",
  scope: "CONNECT",
  token_type: "bearer",
});

function toolNamed(ctx: PluginContext, name: string): Tool {
  const found = garmin.tools(ctx).find((item) => item.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

function api(handler: (url: URL, init: RequestInit | undefined, n: number) => Response): typeof fetch {
  let n = 0;
  return scripted((url, init) => {
    n += 1;
    return handler(url, init, n);
  });
}

describe("ready and auth", () => {
  it("skips without credentials, then without a token", async () => {
    const bare = makeCtx({ env: {} });
    expect(await garmin.ready(bare.ctx)).toBe("no_key");
    const spaced = makeCtx({ env: { GARMIN_EMAIL: "  ", GARMIN_PASSWORD: "x" } });
    expect(await garmin.ready(spaced.ctx)).toBe("no_key");
    const creds = makeCtx();
    expect(await garmin.ready(creds.ctx)).toBe("no_oauth");
    const live = makeCtx({ token: authed() });
    expect(await garmin.ready(live.ctx)).toBeNull();
  });

  it("refuses authStart without env credentials", async () => {
    const { ctx } = makeCtx({ env: {} });
    await expect(garmin.authStart?.(ctx, "https://app/cb", "st")).rejects.toThrow(/GARMIN_EMAIL and GARMIN_PASSWORD/);
  });

  it("stores a DI token when login returns a service ticket", async () => {
    const { ctx, sink, tokens } = makeCtx({
      fetch: scripted((url) => {
        if (url.pathname.endsWith("/mobile/api/login")) {
          return jsonResponse(200, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-1"}`);
        }
        return jsonResponse(200, tokenBody);
      }),
    });
    await garmin.ready(ctx);
    ctx.sql.exec(
      "INSERT INTO garmin_mfa_pending (id, payload, expires_at) VALUES (1, ?, ?)",
      `{"state":"old"}`,
      NOW + 60_000,
    );
    const started = await garmin.authStart?.(ctx, "https://app/cb", "st");
    expect(started).toEqual({
      instruction: `garmin: authorized ✓\nguide: ${AUTH_GUIDE_URL}`,
      url: AUTH_GUIDE_URL,
    });
    expect(tokens.token?.accessToken).toBe(access);
    expect(tokens.token?.refreshToken).toBe("rotated");
    expect(tokens.token?.scope).toBe("CONNECT");
    expect(tokens.token?.tokenType).toBe("bearer");
    expect(tokens.token?.expiresAt).toBe(NOW + 3_600_000);
    expect(tokens.token?.extra).toEqual({ diClientId: "from-jwt", domain: "garmin.com" });
    expect(JSON.stringify(sink.records)).not.toContain("secret");
    await expect(garmin.authFinish?.(ctx, "https://app/cb", "123456")).rejects.toThrow(/no pending MFA/);
  });

  it("holds MFA in sqlite until the pasted code finishes login", async () => {
    const seen: string[] = [];
    const { ctx, clock, tokens } = makeCtx({
      fetch: scripted((url, init) => {
        seen.push(url.pathname);
        if (url.pathname.endsWith("/mobile/api/login")) {
          return jsonResponse(
            200,
            `{"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"phone"}}`,
            { "set-cookie": "SESSION=abc; Path=/" },
          );
        }
        if (url.pathname.endsWith("/verifyCode")) {
          expect(header(init, "cookie")).toBe("SESSION=abc");
          expect(bodyText(init)).toContain(`"mfaVerificationCode":"123456"`);
          return jsonResponse(200, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-chat"}`);
        }
        return jsonResponse(200, tokenBody);
      }),
    });
    const started = await garmin.authStart?.(ctx, "https://app/cb", "state-1");
    expect(started?.url).toBe(AUTH_GUIDE_URL);
    expect(started?.instruction).toContain("MFA required (phone)");
    expect(started?.instruction).toContain("/auth garmin <code>");
    const row = ctx.sql.one<{ payload: string }>("SELECT payload FROM garmin_mfa_pending WHERE id = 1");
    expect(row?.payload).toContain(`"state":"state-1"`);
    expect(row?.payload).toContain("https://app/cb");
    await expect(garmin.authFinish?.(ctx, "https://app/cb", "  ")).rejects.toThrow(/empty MFA code/);
    clock.tick(10 * 60_000);
    await garmin.authFinish?.(ctx, "https://app/cb", " 123456 ");
    expect(tokens.token?.refreshToken).toBe("rotated");
    expect(ctx.sql.one("SELECT id FROM garmin_mfa_pending WHERE id = 1")).toBeNull();
    expect(seen.some((path) => path.endsWith("/oauth/token"))).toBe(true);
  });

  it("rejects an expired or corrupt MFA pending row", async () => {
    const { ctx, clock } = makeCtx({
      fetch: scripted((url) => {
        if (url.pathname.endsWith("/mobile/api/login")) {
          return jsonResponse(200, `{"responseStatus":{"type":"MFA_REQUIRED"}}`);
        }
        return jsonResponse(200, tokenBody);
      }),
    });
    await garmin.authStart?.(ctx, "https://app/cb", "st");
    clock.tick(10 * 60_000 + 1);
    await expect(garmin.authFinish?.(ctx, "https://app/cb", "123456")).rejects.toThrow(/MFA pending expired/);

    const again = makeCtx();
    await garmin.ready(again.ctx);
    again.ctx.sql.exec(
      "INSERT INTO garmin_mfa_pending (id, payload, expires_at) VALUES (1, ?, ?)",
      "{",
      NOW + 60_000,
    );
    await expect(garmin.authFinish?.(again.ctx, "https://app/cb", "123456")).rejects.toThrow(/corrupt MFA pending/);
  });
});

describe("published tools", () => {
  const names = [
    "sleep_get",
    "wellness_get_body_battery",
    "hrv_get",
    "weight_get",
    "activities_list",
    "activities_get",
    "activities_get_typed_splits",
    "activities_get_split_summaries",
    "metrics_get_training_readiness",
    "utility_get_current_date",
  ];

  it("publishes the core tier in registry order", () => {
    const { ctx } = makeCtx({ token: authed() });
    expect(garmin.name).toBe("garmin");
    expect(garmin.tools(ctx).map((item) => item.name)).toEqual(names);
    const sleep = toolNamed(ctx, "sleep_get");
    expect(sleep.description).toContain("ONLY tool for overnight sleep");
    expect(sleep.inputSchema).toEqual({
      properties: {
        date: {
          description: "Wake-up calendar day (YYYY-MM-DD). CRITICAL: 'last night' / 'this morning' = TODAY "
            + "(or omit). Example: if today is 2026-07-28, pass 2026-07-28 — NOT 2026-07-27. Defaults to today.",
          type: "string",
        },
        dates: {
          description: "Calendar days to fetch together (YYYY-MM-DD, max 31)",
          items: { type: "string" },
          type: "array",
        },
        end: {
          description: "Inclusive end (YYYY-MM-DD). Span with start is at most 31 days.",
          type: "string",
        },
        start: {
          description: "Inclusive start (YYYY-MM-DD). Span with end is at most 31 days.",
          type: "string",
        },
      },
      type: "object",
    });
    const list = toolNamed(ctx, "activities_list");
    expect(Object.keys(list.inputSchema.properties as object)).toEqual(["limit", "start"]);
    const detail = toolNamed(ctx, "activities_get");
    expect(detail.inputSchema).toMatchObject({
      properties: {
        activity_id: { description: "The activity ID", type: "number" },
        ids: { items: { type: "number" }, type: "array" },
      },
      type: "object",
    });
    expect(detail.inputSchema.required).toBeUndefined();
    expect(toolNamed(ctx, "utility_get_current_date").inputSchema).toEqual({ properties: {}, type: "object" });
  });

  it("formats the injected local date", async () => {
    const { ctx } = makeCtx({ token: authed() });
    const result = await toolNamed(ctx, "utility_get_current_date").call({}, call);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(goJSON({
      date: "2026-01-26",
      day: 26,
      iso8601: "2026-01-26T15:04:05Z",
      month: 1,
      month_name: "January",
      weekday: "Monday",
      year: 2026,
    }));
  });

  it("projects sleep, HRV, weight, body battery, and readiness", async () => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      fetch: api((url, init) => {
        expect(header(init, "authorization")).toBe("Bearer access");
        expect(header(init, "user-agent")).toBe("GCM-Android-5.23");
        paths.push(`${url.pathname}${url.search}`);
        if (url.pathname.includes("/sleep/")) {
          return jsonResponse(200, JSON.stringify({
            dailySleepDTO: { calendarDate: "2026-01-26", sleepTimeSeconds: 28800, surprise: true },
            remSleepData: true,
          }));
        }
        if (url.pathname.includes("/hrv/")) {
          return jsonResponse(200, JSON.stringify({
            hrvSummary: { calendarDate: "2026-01-26", feedbackPhrase: "a&b<c", lastNightAvg: 42 },
          }));
        }
        if (url.pathname.includes("/weight/")) {
          return jsonResponse(200, JSON.stringify({
            dateWeightList: [{ calendarDate: "2026-01-26", weight: 70.5 }],
            endDate: "2026-01-26",
            startDate: "2026-01-26",
          }));
        }
        if (url.pathname.includes("bodyBattery")) {
          return jsonResponse(200, JSON.stringify([{
            activityId: null,
            event: { bodyBatteryImpact: 5, eventType: "SLEEP" },
          }]));
        }
        return jsonResponse(200, JSON.stringify([{ calendarDate: "2026-01-26", score: 80 }]));
      }),
      token: authed(),
    });

    const [sleep] = JSON.parse(textOf(await toolNamed(ctx, "sleep_get").call({}, call))) as [{
      date: string;
      dailySleepDTO: { calendarDate: string; sleepTimeSeconds: number; id: null; surprise?: boolean };
      remSleepData: boolean;
    }];
    expect(sleep?.date).toBe("2026-01-26");
    expect(sleep.dailySleepDTO.calendarDate).toBe("2026-01-26");
    expect(sleep.dailySleepDTO.sleepTimeSeconds).toBe(28800);
    expect(sleep.dailySleepDTO.id).toBeNull();
    expect(sleep.dailySleepDTO.surprise).toBeUndefined();
    expect(sleep.remSleepData).toBe(true);
    expect(paths[0]).toBe("/sleep-service/sleep/dailySleepData?date=2026-01-26");

    const hrvText = textOf(await toolNamed(ctx, "hrv_get").call({ date: "2026-01-25" }, call));
    expect(hrvText).toContain(String.raw`a\u0026b\u003cc`);
    const [hrv] = JSON.parse(hrvText) as [{ date: string; hrvSummary: { lastNightAvg: number }; userProfilePk: number }];
    expect(hrv?.date).toBe("2026-01-25");
    expect(hrv.hrvSummary.lastNightAvg).toBe(42);
    expect(hrv.userProfilePk).toBe(0);
    expect(paths[1]).toBe("/hrv-service/hrv/2026-01-25");

    const [weight] = JSON.parse(textOf(await toolNamed(ctx, "weight_get").call({ date: "2026-01-26" }, call))) as [{
      date: string;
      dateWeightList: { weight: number }[];
    }];
    expect(weight?.date).toBe("2026-01-26");
    expect(weight.dateWeightList[0]?.weight).toBe(70.5);
    expect(paths[2]).toBe("/weight-service/weight/dayview/2026-01-26");

    const [battery] = JSON.parse(textOf(await toolNamed(ctx, "wellness_get_body_battery").call({}, call))) as [{
      date: string;
      Events: { event: { eventType: string }; activityName: null }[];
    }];
    expect(battery?.date).toBe("2026-01-26");
    expect(battery.Events[0]?.event.eventType).toBe("SLEEP");
    expect(battery.Events[0]?.activityName).toBeNull();
    expect(paths[3]).toBe("/wellness-service/wellness/bodyBattery/events/2026-01-26");

    const [ready] = JSON.parse(textOf(await toolNamed(ctx, "metrics_get_training_readiness").call({}, call))) as [{
      date: string;
      Entries: { score: number; sleepScore: null; validSleep?: boolean }[];
    }];
    expect(ready?.date).toBe("2026-01-26");
    expect(ready.Entries[0]?.score).toBe(80);
    expect(ready.Entries[0]?.sleepScore).toBeNull();
    expect(paths[4]).toBe("/metrics-service/metrics/trainingreadiness/2026-01-26");
  });

  it("reports not found, a bad date, and a missing activity id as tool errors", async () => {
    const { ctx } = makeCtx({
      fetch: api(() => jsonResponse(404, "")),
      token: authed(),
    });
    const missing = await toolNamed(ctx, "sleep_get").call({}, call);
    expect(missing.isError).toBeUndefined();
    expect(JSON.parse(textOf(missing))).toEqual([{ date: "2026-01-26", error: "garmin: resource not found" }]);
    const bad = await toolNamed(ctx, "hrv_get").call({ date: "nope" }, call);
    expect(textOf(bad)).toContain(`parsing time "nope" as "2006-01-02"`);
    const day = await toolNamed(ctx, "weight_get").call({ date: "2026-02-31" }, call);
    expect(textOf(day)).toContain("day out of range");
    const id = await toolNamed(ctx, "activities_get").call({}, call);
    expect(textOf(id)).toBe("missing required parameter: activity_id");
    const anon = makeCtx();
    const locked = await toolNamed(anon.ctx, "sleep_get").call({}, call);
    expect(JSON.parse(textOf(locked))).toEqual([{ date: "2026-01-26", error: "garmin: not authenticated" }]);
  });

  it("lists activities with climb fields and loads detail, typed splits, and summaries", async () => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      fetch: api((url) => {
        paths.push(`${url.pathname}${url.search}`);
        if (url.pathname.includes("/search/")) {
          return jsonResponse(200, JSON.stringify([{
            activityId: 7,
            activityName: "Indoor Climbing",
            activityType: { typeKey: "indoor_climbing" },
            splitSummaries: [{
              maxGradeValue: { scale: "YDS", valueKey: "_5_11D" },
              numClimbSends: 2,
              numClimbsCompleted: 5,
              numFalls: 6,
              splitType: "CLIMB_ACTIVE",
            }],
            surprise: true,
          }]));
        }
        if (url.pathname.endsWith("/typedsplits")) {
          return jsonResponse(200, JSON.stringify({
            activityId: 7,
            splits: [{ status: "CLIMB_COMPLETED", type: "CLIMB_ACTIVE" }],
          }));
        }
        if (url.pathname.endsWith("/split_summaries")) {
          return jsonResponse(200, JSON.stringify({
            activityId: 7,
            splitSummaries: [{ numFalls: 6, splitType: "CLIMB_ACTIVE" }],
          }));
        }
        return jsonResponse(200, JSON.stringify({ activityId: 9, activityName: "Run", surprise: true }));
      }),
      token: authed(),
    });
    const listed = JSON.parse(textOf(await toolNamed(ctx, "activities_list").call({}, call))) as {
      activityId: number;
      maxClimbGrade: string;
      surprise?: boolean;
    }[];
    expect(listed[0]?.activityId).toBe(7);
    expect(listed[0]?.maxClimbGrade).toBe("5.11d");
    expect(listed[0]?.surprise).toBeUndefined();
    expect(paths[0]).toBe("/activitylist-service/activities/search/activities?start=0&limit=20");
    const limited = await toolNamed(ctx, "activities_list").call({ limit: 2, start: 5 }, call);
    expect(limited.isError).toBeUndefined();
    expect(paths[1]).toContain("start=5&limit=2");

    const [detail] = JSON.parse(textOf(await toolNamed(ctx, "activities_get").call({ activity_id: 9 }, call))) as [{
      activityId: number;
      activityName: string;
      activityUUID: { uuid: string };
      splitSummaries: null;
      surprise?: boolean;
    }];
    expect(detail.activityId).toBe(9);
    expect(detail.activityName).toBe("Run");
    expect(detail.activityUUID.uuid).toBe("");
    expect(detail.splitSummaries).toBeNull();
    expect(detail.surprise).toBeUndefined();
    expect(paths[2]).toBe("/activity-service/activity/9");

    const [splits] = JSON.parse(textOf(await toolNamed(ctx, "activities_get_typed_splits").call({ activity_id: "7" }, call))) as [{
      splits: { status: string; type: string }[];
    }];
    expect(splits.splits[0]?.status).toBe("CLIMB_COMPLETED");
    expect(paths[3]).toBe("/activity-service/activity/7/typedsplits");

    const [summaries] = JSON.parse(textOf(await toolNamed(ctx, "activities_get_split_summaries").call({ activity_id: 7 }, call))) as [{
      splitSummaries: { numFalls: number }[];
    }];
    expect(summaries.splitSummaries[0]?.numFalls).toBe(6);
    expect(paths[4]).toBe("/activity-service/activity/7/split_summaries");
  });

  it("loads the daily summary by display name", async () => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      fetch: api((url) => {
        paths.push(url.pathname + url.search);
        if (url.pathname.endsWith("/socialProfile")) {
          return jsonResponse(200, JSON.stringify({ displayName: "ada" }));
        }
        return jsonResponse(200, JSON.stringify({ calendarDate: "2026-01-26", totalSteps: 9000 }));
      }),
      env: extendedEnv,
      token: authed(),
    });
    const [summary] = JSON.parse(textOf(await toolNamed(ctx, "summary_get_daily").call({}, call))) as [{
      calendarDate: string;
      date: string;
      totalSteps: number;
      userProfileId: number;
    }];
    expect(summary?.date).toBe("2026-01-26");
    expect(summary.totalSteps).toBe(9000);
    expect(summary.userProfileId).toBe(0);
    expect(paths[0]).toBe("/userprofile-service/socialProfile");
    expect(paths[1]).toBe("/usersummary-service/usersummary/daily/ada?calendarDate=2026-01-26");

    const named = makeCtx({
      env: extendedEnv,
      fetch: api((url) => {
        expect(url.pathname).not.toContain("socialProfile");
        return jsonResponse(200, JSON.stringify({ totalSteps: 1 }));
      }),
      token: authed(),
    });
    const override = await toolNamed(named.ctx, "summary_get_daily").call({ display_name: "other" }, call);
    expect(override.isError).toBeUndefined();

    const empty = makeCtx({
      env: extendedEnv,
      fetch: api(() => jsonResponse(200, JSON.stringify({ displayName: "" }))),
      token: authed(),
    });
    const failed = await toolNamed(empty.ctx, "summary_get_daily").call({}, call);
    expect(textOf(failed)).toBe("social profile has empty display name");
  });

  it("refreshes an expired token and retries a 401 once", async () => {
    const boundary: Session = {
      accessToken: "access",
      diClientId: "client",
      domain: "garmin.com",
      expiresAt: NOW + 5 * 60_000,
      extra: {},
      refreshToken: "refresh",
    };
    expect(isExpired(boundary, NOW)).toBe(false);
    expect(isExpired({ ...boundary, expiresAt: NOW + 5 * 60_000 - 1 }, NOW)).toBe(true);

    let sleepHits = 0;
    const refreshed = makeCtx({
      fetch: scripted((url, init) => {
        if (url.host.startsWith("diauth.")) {
          expect(bodyText(init)).toContain("grant_type=refresh_token");
          return jsonResponse(200, JSON.stringify({ access_token: "new-access", expires_in: 60, refresh_token: "new-refresh" }));
        }
        sleepHits += 1;
        expect(header(init, "authorization")).toBe("Bearer new-access");
        return jsonResponse(200, JSON.stringify({ dailySleepDTO: { sleepTimeSeconds: 1 } }));
      }),
      token: authed({ expiresAt: NOW }),
    });
    const [slept] = JSON.parse(textOf(await toolNamed(refreshed.ctx, "sleep_get").call({}, call))) as [{
      dailySleepDTO: { sleepTimeSeconds: number };
    }];
    expect(slept.dailySleepDTO.sleepTimeSeconds).toBe(1);
    expect(refreshed.tokens.token?.accessToken).toBe("new-access");
    expect(refreshed.tokens.token?.refreshToken).toBe("new-refresh");
    expect(refreshed.sink.records.some((record) => record.message === "garmin token refreshed")).toBe(true);
    expect(sleepHits).toBe(1);

    let hits = 0;
    const denied = makeCtx({
      fetch: scripted((url) => {
        if (url.host.startsWith("diauth.")) {
          return jsonResponse(200, JSON.stringify({ access_token: "after-401", expires_in: 60 }));
        }
        hits += 1;
        if (hits === 1) return jsonResponse(401, "expired");
        return jsonResponse(200, JSON.stringify({ dailySleepDTO: { sleepTimeSeconds: 2 } }));
      }),
      token: authed(),
    });
    const [retry] = JSON.parse(textOf(await toolNamed(denied.ctx, "sleep_get").call({}, call))) as [{
      dailySleepDTO: { sleepTimeSeconds: number };
    }];
    expect(retry.dailySleepDTO.sleepTimeSeconds).toBe(2);
    expect(denied.tokens.token?.accessToken).toBe("after-401");
    expect(hits).toBe(2);

    const stale = makeCtx({
      token: authed({ expiresAt: NOW, extra: { diClientId: "", domain: "garmin.com" }, refreshToken: "" }),
    });
    const blocked = await toolNamed(stale.ctx, "sleep_get").call({}, call);
    expect(textOf(blocked)).toContain("missing DI refresh token or client id");
  });
});

describe("plural days and ids", () => {
  const dayTools: [string, (date: string) => string][] = [
    ["sleep_get", (date) => `/sleep-service/sleep/dailySleepData?date=${date}`],
    ["hrv_get", (date) => `/hrv-service/hrv/${date}`],
    ["weight_get", (date) => `/weight-service/weight/dayview/${date}`],
    ["wellness_get_body_battery", (date) => `/wellness-service/wellness/bodyBattery/events/${date}`],
    ["metrics_get_training_readiness", (date) => `/metrics-service/metrics/trainingreadiness/${date}`],
  ];

  it.each(dayTools)("%s fetches an inclusive range and a dates list", async (name, path) => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      fetch: scripted((url) => {
        paths.push(`${url.pathname}${url.search}`);
        const list = url.pathname.includes("bodyBattery") || url.pathname.includes("trainingreadiness");
        return jsonResponse(200, list ? "[]" : "{}");
      }),
      token: authed(),
    });
    const ranged = JSON.parse(textOf(await toolNamed(ctx, name).call({ end: "2026-01-26", start: "2026-01-25" }, call))) as { date: string }[];
    expect(ranged.map((row) => row.date)).toEqual(["2026-01-25", "2026-01-26"]);
    expect(paths.slice().sort()).toEqual([path("2026-01-25"), path("2026-01-26")].sort());

    paths.length = 0;
    const listed = JSON.parse(textOf(await toolNamed(ctx, name).call({ dates: ["2026-01-20", "2026-01-22"] }, call))) as { date: string }[];
    expect(listed.map((row) => row.date)).toEqual(["2026-01-20", "2026-01-22"]);
    expect(paths.slice().sort()).toEqual([path("2026-01-20"), path("2026-01-22")].sort());

    const one = JSON.parse(textOf(await toolNamed(ctx, name).call({ date: "2026-01-24" }, call))) as { date: string }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.date).toBe("2026-01-24");
  });

  it("sleep_get caps the span and keeps a failed day in the list", async () => {
    const { ctx } = makeCtx({
      fetch: scripted((url) => jsonResponse(url.search.includes("2026-01-26") ? 404 : 200, "{}")),
      token: authed(),
    });
    const rows = JSON.parse(textOf(await toolNamed(ctx, "sleep_get").call({ end: "2026-01-26", start: "2026-01-25" }, call))) as { date: string; error?: string }[];
    expect(rows[0]?.date).toBe("2026-01-25");
    expect(rows[0]?.error).toBeUndefined();
    expect(rows[1]).toEqual({ date: "2026-01-26", error: "garmin: resource not found" });
    const capped = await toolNamed(ctx, "sleep_get").call({ end: "2026-02-05", start: "2026-01-01" }, call);
    expect(capped.isError).toBe(true);
    expect(textOf(capped)).toContain("date span exceeds 31 days");
    expect(toolNamed(ctx, "utility_get_current_date").single).toContain("clock");
  });

  const idTools: [string, (id: number) => string][] = [
    ["activities_get", (id) => `/activity-service/activity/${id}`],
    ["activities_get_typed_splits", (id) => `/activity-service/activity/${id}/typedsplits`],
    ["activities_get_split_summaries", (id) => `/activity-service/activity/${id}/split_summaries`],
  ];

  it.each(idTools)("%s accepts ids and still accepts activity_id", async (name, path) => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      fetch: scripted((url) => {
        paths.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith("/8") || url.pathname.includes("/8/")) return jsonResponse(404, "");
        return jsonResponse(200, "{}");
      }),
      token: authed(),
    });
    const many = JSON.parse(textOf(await toolNamed(ctx, name).call({ ids: [8, 9] }, call))) as { activityId?: number; activity_id?: number; error?: string }[];
    expect(many).toHaveLength(2);
    expect(many[0]?.error).toBe("garmin: resource not found");
    expect(many[0]?.activity_id).toBe(8);
    expect(many[1]?.error).toBeUndefined();
    expect(paths.slice().sort()).toEqual([path(8), path(9)].sort());
    const one = JSON.parse(textOf(await toolNamed(ctx, name).call({ activity_id: 9 }, call))) as unknown[];
    expect(one).toHaveLength(1);
  });
});

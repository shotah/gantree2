import { describe, expect, it } from "vitest";
import type { PluginContext, Tool } from "@/brain/core/tools";
import { garmin } from "@/brain/plugins/garmin";
import { authed, call, jsonResponse, makeCtx, scripted, textOf } from "./harness";

const extendedEnv = {
  GARMIN_EMAIL: "ada@example.com",
  GARMIN_PASSWORD: "secret",
  GARMIN_TOOL_TIER: "extended",
};

const extendedNames = [
  "sleep_get",
  "wellness_get_stress",
  "wellness_get_body_battery",
  "wellness_get_heart_rate",
  "wellness_get_intensity_minutes",
  "wellness_get_body_battery_reports",
  "wellness_get_sleep_score_stats",
  "hrv_get",
  "weight_get",
  "activities_list",
  "activities_get",
  "activities_get_details",
  "activities_get_typed_splits",
  "activities_get_split_summaries",
  "metrics_get_training_readiness",
  "metrics_get_vo_two_max",
  "metrics_get_training_status",
  "utility_get_current_date",
  "summary_get_daily",
];

function toolNamed(ctx: PluginContext, name: string): Tool {
  const found = garmin.tools(ctx).find((item) => item.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

function ctxFor(body: string, tier = "extended") {
  const paths: string[] = [];
  const made = makeCtx({
    env: { ...extendedEnv, GARMIN_TOOL_TIER: tier },
    fetch: scripted((url) => {
      paths.push(`${url.pathname}${url.search}`);
      return jsonResponse(200, body);
    }),
    token: authed(),
  });
  return { ...made, paths };
}

describe("tool tier", () => {
  it("publishes core unless GARMIN_TOOL_TIER asks for extended or complete", () => {
    const core = makeCtx({ token: authed() });
    const names = garmin.tools(core.ctx).map((item) => item.name);
    expect(names).not.toContain("wellness_get_stress");
    expect(names).not.toContain("summary_get_daily");
    expect(names).toContain("sleep_get");

    const bogus = makeCtx({
      env: { ...extendedEnv, GARMIN_TOOL_TIER: "nope" },
      token: authed(),
    });
    expect(garmin.tools(bogus.ctx).map((item) => item.name)).toEqual(names);

    const upper = makeCtx({
      env: { ...extendedEnv, GARMIN_TOOL_TIER: " EXTENDED " },
      token: authed(),
    });
    expect(garmin.tools(upper.ctx).map((item) => item.name)).toEqual(extendedNames);

    const complete = makeCtx({
      env: { ...extendedEnv, GARMIN_TOOL_TIER: "complete" },
      token: authed(),
    });
    expect(garmin.tools(complete.ctx).map((item) => item.name)).toEqual(extendedNames);

    const reports = toolNamed(upper.ctx, "wellness_get_body_battery_reports");
    expect(Object.keys(reports.inputSchema.properties as object)).toEqual(["date", "dates", "end", "start"]);
    expect(reports.inputSchema).toMatchObject({
      properties: {
        end: { description: "End date (YYYY-MM-DD)", type: "string" },
        start: { description: "Start date (YYYY-MM-DD)", type: "string" },
      },
      type: "object",
    });
    expect(toolNamed(upper.ctx, "wellness_get_stress").description).toContain("Intraday stress levels");
    expect(toolNamed(upper.ctx, "activities_get_details").description).toContain("time-series metrics");
  });
});

describe("extended wellness", () => {
  it("projects daily stress", async () => {
    const { ctx, paths } = ctxFor(`{
      "calendarDate": "2026-01-26",
      "maxStressLevel": 85,
      "avgStressLevel": 42,
      "stressValuesArray": [[1737853200000, 12], [1737856800000, 25]],
      "bodyBatteryValuesArray": [[1737853200000, "charging", 45, 1.0]],
      "surprise": true
    }`);
    const [stress] = JSON.parse(textOf(await toolNamed(ctx, "wellness_get_stress").call({ date: "2026-01-26" }, call))) as [{
      avgStressLevel: number;
      bodyBatteryValuesArray: unknown[][];
      calendarDate: string;
      date: string;
      maxStressLevel: number;
      stressValuesArray: number[][];
      surprise?: boolean;
    }];
    expect(stress?.date).toBe("2026-01-26");
    expect(stress.calendarDate).toBe("2026-01-26");
    expect(stress.maxStressLevel).toBe(85);
    expect(stress.avgStressLevel).toBe(42);
    expect(stress.stressValuesArray).toEqual([[1737853200000, 12], [1737856800000, 25]]);
    expect(stress.bodyBatteryValuesArray).toEqual([[1737853200000, "charging", 45, 1]]);
    expect(stress.surprise).toBeUndefined();
    expect(paths[0]).toBe("/wellness-service/wellness/dailyStress/2026-01-26");
  });

  it("projects heart rate and intensity minutes", async () => {
    const hr = ctxFor(`{
      "userProfilePK": 12345678,
      "calendarDate": "2026-01-27",
      "maxHeartRate": 119,
      "minHeartRate": 50,
      "restingHeartRate": 51,
      "lastSevenDaysAvgRestingHeartRate": 54,
      "heartRateValueDescriptors": [{"key": "timestamp", "index": 0}, {"key": "heartrate", "index": 1}],
      "heartRateValues": [[1769457600000, 51], [1769457720000, 52]]
    }`);
    const [parsed] = JSON.parse(textOf(await toolNamed(hr.ctx, "wellness_get_heart_rate").call({ date: "2026-01-27" }, call))) as [{
      date: string;
      heartRateValueDescriptors: { index: number; key: string }[];
      heartRateValues: number[][];
      maxHeartRate: number;
      restingHeartRate: number;
      userProfilePK: number;
    }];
    expect(parsed?.date).toBe("2026-01-27");
    expect(parsed.userProfilePK).toBe(12345678);
    expect(parsed.maxHeartRate).toBe(119);
    expect(parsed.restingHeartRate).toBe(51);
    expect(parsed.heartRateValueDescriptors).toHaveLength(2);
    expect(parsed.heartRateValues[0]?.[1]).toBe(51);
    expect(hr.paths[0]).toBe("/wellness-service/wellness/dailyHeartRate/?date=2026-01-27");

    const minutes = ctxFor(`{
      "userProfilePK": 12345678,
      "calendarDate": "2026-01-27",
      "weeklyModerate": 14,
      "weeklyVigorous": 0,
      "weeklyTotal": 14,
      "weekGoal": 240,
      "dayOfGoalMet": null,
      "moderateMinutes": 7,
      "vigorousMinutes": 0,
      "imValueDescriptorsDTOList": [{"index": 0, "key": "timestamp"}],
      "imValuesArray": [[1769486400000, 7]]
    }`);
    const [im] = JSON.parse(textOf(await toolNamed(minutes.ctx, "wellness_get_intensity_minutes").call({}, call))) as [{
      calendarDate: string;
      date: string;
      dayOfGoalMet: null;
      imValueDescriptorsDTOList: unknown[];
      imValuesArray: number[][];
      moderateMinutes: number;
      userProfilePK: number;
      vigorousMinutes: number;
      weekGoal: number;
      weeklyModerate: number;
      weeklyTotal: number;
      weeklyVigorous: number;
    }];
    expect(im?.date).toBe("2026-01-26");
    expect(im.userProfilePK).toBe(12345678);
    expect(im.calendarDate).toBe("2026-01-27");
    expect(im.weeklyModerate).toBe(14);
    expect(im.weeklyVigorous).toBe(0);
    expect(im.weeklyTotal).toBe(14);
    expect(im.weekGoal).toBe(240);
    expect(im.moderateMinutes).toBe(7);
    expect(im.vigorousMinutes).toBe(0);
    expect(im.dayOfGoalMet).toBeNull();
    expect(im.imValueDescriptorsDTOList).toHaveLength(1);
    expect(im.imValuesArray).toHaveLength(1);
    expect(minutes.paths[0]).toBe("/wellness-service/wellness/daily/im/2026-01-26");
  });

  it("projects body battery reports and sleep scores over a range", async () => {
    const reports = ctxFor(`[{"date":"2026-01-27","charged":45,"drained":60,"bodyBatteryValuesArray":[[1,"charging",50,1.0]]}]`);
    const battery = JSON.parse(textOf(await toolNamed(reports.ctx, "wellness_get_body_battery_reports").call({}, call))) as {
      charged: number;
      date: string;
      drained: number;
    }[];
    expect(battery).toHaveLength(1);
    expect(battery[0]?.charged).toBe(45);
    expect(battery[0]?.drained).toBe(60);
    expect(battery[0]?.date).toBe("2026-01-27");
    expect(reports.paths[0]).toBe("/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-01-19&endDate=2026-01-26");

    const onlyEnd = ctxFor("[]");
    await toolNamed(onlyEnd.ctx, "wellness_get_body_battery_reports").call({ end: "2026-01-20" }, call);
    expect(onlyEnd.paths[0]).toContain("startDate=2026-01-19&endDate=2026-01-20");

    const both = ctxFor("[]");
    await toolNamed(both.ctx, "wellness_get_sleep_score_stats").call({ end: "2026-01-20", start: "2026-01-01" }, call);
    expect(both.paths[0]).toBe("/wellness-service/stats/daily/sleep/score/2026-01-01/2026-01-20");

    const scores = ctxFor(`[{"calendarDate":"2026-01-27","value":82,"qualifierKey":"GOOD"}]`);
    const stats = JSON.parse(textOf(await toolNamed(scores.ctx, "wellness_get_sleep_score_stats").call({ start: "2026-01-20" }, call))) as {
      date: string;
      qualifierKey: string;
      value: number;
    }[];
    expect(stats[0]?.value).toBe(82);
    expect(stats[0]?.qualifierKey).toBe("GOOD");
    expect(stats[0]?.date).toBe("2026-01-27");
    expect(scores.paths[0]).toBe("/wellness-service/stats/daily/sleep/score/2026-01-20/2026-01-26");

    const bad = await toolNamed(scores.ctx, "wellness_get_body_battery_reports").call({ start: "nope" }, call);
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain(`invalid start date: parsing time "nope" as "2006-01-02"`);
  });
});

describe("extended metrics and activity details", () => {
  it("projects VO2 max", async () => {
    const { ctx, paths } = ctxFor(`{
      "userId": 12345678,
      "generic": {
        "calendarDate": "2026-01-25",
        "vo2MaxPreciseValue": 50.1,
        "vo2MaxValue": 50.0,
        "fitnessAge": null,
        "maxMetCategory": 0
      },
      "cycling": null,
      "heatAltitudeAcclimation": {
        "calendarDate": "2026-01-27",
        "heatAcclimationPercentage": 100,
        "heatTrend": "ACCLIMATIZED",
        "altitudeAcclimation": 0
      }
    }`);
    const [vo2] = JSON.parse(textOf(await toolNamed(ctx, "metrics_get_vo_two_max").call({}, call))) as [{
      date: string;
      cycling: null;
      generic: { fitnessAge: null; vo2MaxPreciseValue: number; vo2MaxValue: number };
      heatAltitudeAcclimation: { altitudeTrend: null; heatAcclimationPercentage: number; heatTrend: string };
      userId: number;
    }];
    expect(vo2?.date).toBe("2026-01-26");
    expect(vo2.userId).toBe(12345678);
    expect(vo2.generic.vo2MaxValue).toBe(50);
    expect(vo2.generic.vo2MaxPreciseValue).toBe(50.1);
    expect(vo2.generic.fitnessAge).toBeNull();
    expect(vo2.cycling).toBeNull();
    expect(vo2.heatAltitudeAcclimation.heatAcclimationPercentage).toBe(100);
    expect(vo2.heatAltitudeAcclimation.heatTrend).toBe("ACCLIMATIZED");
    expect(vo2.heatAltitudeAcclimation.altitudeTrend).toBeNull();
    expect(paths[0]).toBe("/metrics-service/metrics/maxmet/latest/2026-01-26");
  });

  it("projects aggregated training status", async () => {
    const { ctx, paths } = ctxFor(`{
      "userId": 12345678,
      "mostRecentTrainingStatus": {
        "userId": 12345678,
        "latestTrainingStatusData": {
          "3490854130": {
            "calendarDate": "2026-01-27",
            "trainingStatus": 7,
            "trainingStatusFeedbackPhrase": "PRODUCTIVE_1",
            "trainingPaused": false,
            "acuteTrainingLoadDTO": {
              "acwrPercent": 47,
              "acwrStatus": "OPTIMAL",
              "dailyTrainingLoadAcute": 249,
              "dailyAcuteChronicWorkloadRatio": 1.1
            },
            "primaryTrainingDevice": true
          }
        },
        "recordedDevices": [{"deviceId": 3490854130, "deviceName": "Forerunner 965", "category": 0}],
        "showSelector": false
      },
      "mostRecentTrainingLoadBalance": {
        "userId": 12345678,
        "metricsTrainingLoadBalanceDTOMap": {
          "3490854130": {
            "calendarDate": "2026-01-27",
            "deviceId": 3490854130,
            "monthlyLoadAerobicLow": 187.12,
            "monthlyLoadAerobicHigh": 209.70,
            "monthlyLoadAnaerobic": 0.0,
            "trainingBalanceFeedbackPhrase": "AEROBIC_HIGH_SHORTAGE",
            "primaryTrainingDevice": true
          }
        }
      }
    }`);
    const [status] = JSON.parse(textOf(await toolNamed(ctx, "metrics_get_training_status").call({ date: "2026-01-27" }, call))) as [{
      mostRecentTrainingLoadBalance: {
        metricsTrainingLoadBalanceDTOMap: Record<string, { trainingBalanceFeedbackPhrase: string }>;
        recordedDevices: null;
      };
      mostRecentTrainingStatus: {
        latestTrainingStatusData: Record<string, {
          acuteTrainingLoadDTO: { acwrStatus: string };
          trainingStatus: number;
          weeklyTrainingLoad: null;
        }>;
        showSelector: boolean;
        userId: number;
      };
      mostRecentVO2Max: null;
      userId: number;
    }];
    expect(status?.userId).toBe(12345678);
    expect(status.mostRecentVO2Max).toBeNull();
    const device = status.mostRecentTrainingStatus.latestTrainingStatusData["3490854130"];
    expect(device?.trainingStatus).toBe(7);
    expect(device?.acuteTrainingLoadDTO.acwrStatus).toBe("OPTIMAL");
    expect(device?.weeklyTrainingLoad).toBeNull();
    expect(status.mostRecentTrainingStatus.showSelector).toBe(false);
    expect(status.mostRecentTrainingLoadBalance.metricsTrainingLoadBalanceDTOMap["3490854130"]?.trainingBalanceFeedbackPhrase)
      .toBe("AEROBIC_HIGH_SHORTAGE");
    expect(status.mostRecentTrainingLoadBalance.recordedDevices).toBeNull();
    expect(paths[0]).toBe("/metrics-service/metrics/trainingstatus/aggregated/2026-01-27");
  });

  it("projects activity time-series details", async () => {
    const { ctx, paths } = ctxFor(`{
      "activityId": 21661023200,
      "measurementCount": 100,
      "metricsCount": 5,
      "totalMetricsCount": 5,
      "metricDescriptors": [
        {"metricsIndex": 0, "key": "directTimestamp", "unit": {"id": 1, "key": "ms", "factor": 1.0}},
        {"metricsIndex": 1, "key": "directHeartRate", "unit": {"id": 2, "key": "bpm", "factor": 1.0}},
        {"metricsIndex": 2, "key": "directSpeed", "unit": {"id": 3, "key": "mps", "factor": 1.0}}
      ],
      "activityDetailMetrics": [
        {"metrics": [0, 120, 2.5]},
        {"metrics": [1000, 125, 2.6]}
      ],
      "surprise": true
    }`);
    const [details] = JSON.parse(textOf(await toolNamed(ctx, "activities_get_details").call({ activity_id: 21661023200 }, call))) as [{
      activityDetailMetrics: { metrics: number[] }[];
      activityId: number;
      measurementCount: number;
      metricDescriptors: { key: string; unit: { key: string } }[];
      metricsCount: number;
      surprise?: boolean;
    }];
    expect(details.activityId).toBe(21661023200);
    expect(details.measurementCount).toBe(100);
    expect(details.metricsCount).toBe(5);
    expect(details.metricDescriptors).toHaveLength(3);
    expect(details.metricDescriptors[1]?.key).toBe("directHeartRate");
    expect(details.metricDescriptors[1]?.unit.key).toBe("bpm");
    expect(details.activityDetailMetrics).toHaveLength(2);
    expect(details.activityDetailMetrics[0]?.metrics).toEqual([0, 120, 2.5]);
    expect(details.surprise).toBeUndefined();
    expect(paths[0]).toBe("/activity-service/activity/21661023200/details");
    const missing = await toolNamed(ctx, "activities_get_details").call({}, call);
    expect(textOf(missing)).toBe("missing required parameter: activity_id");
  });
});

describe("plural extended tools", () => {
  const dayTools: [string, (date: string) => string][] = [
    ["wellness_get_stress", (date) => `/wellness-service/wellness/dailyStress/${date}`],
    ["wellness_get_heart_rate", (date) => `/wellness-service/wellness/dailyHeartRate/?date=${date}`],
    ["wellness_get_intensity_minutes", (date) => `/wellness-service/wellness/daily/im/${date}`],
    ["metrics_get_vo_two_max", (date) => `/metrics-service/metrics/maxmet/latest/${date}`],
    ["metrics_get_training_status", (date) => `/metrics-service/metrics/trainingstatus/aggregated/${date}`],
  ];

  it.each(dayTools)("%s fetches an inclusive range and a single date", async (name, path) => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      env: extendedEnv,
      fetch: scripted((url) => {
        paths.push(`${url.pathname}${url.search}`);
        return jsonResponse(200, "{}");
      }),
      token: authed(),
    });
    const ranged = JSON.parse(textOf(await toolNamed(ctx, name).call({ end: "2026-01-26", start: "2026-01-25" }, call))) as { date: string }[];
    expect(ranged.map((row) => row.date)).toEqual(["2026-01-25", "2026-01-26"]);
    expect(paths.slice().sort()).toEqual([path("2026-01-25"), path("2026-01-26")].sort());
    const one = JSON.parse(textOf(await toolNamed(ctx, name).call({ date: "2026-01-24" }, call))) as { date: string }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.date).toBe("2026-01-24");
  });

  it("summary_get_daily fetches each day after one display-name lookup", async () => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      env: extendedEnv,
      fetch: scripted((url) => {
        paths.push(url.pathname + url.search);
        if (url.pathname.endsWith("/socialProfile")) return jsonResponse(200, JSON.stringify({ displayName: "ada" }));
        return jsonResponse(200, JSON.stringify({ calendarDate: "2026-01-26", totalSteps: 1 }));
      }),
      token: authed(),
    });
    const rows = JSON.parse(textOf(await toolNamed(ctx, "summary_get_daily").call({ dates: ["2026-01-25", "2026-01-26"] }, call))) as { date: string; totalSteps: number }[];
    expect(rows.map((row) => row.date)).toEqual(["2026-01-25", "2026-01-26"]);
    expect(rows[0]?.totalSteps).toBe(1);
    expect(paths[0]).toBe("/userprofile-service/socialProfile");
    expect(paths.slice(1).sort()).toEqual([
      "/usersummary-service/usersummary/daily/ada?calendarDate=2026-01-25",
      "/usersummary-service/usersummary/daily/ada?calendarDate=2026-01-26",
    ]);
    const one = JSON.parse(textOf(await toolNamed(ctx, "summary_get_daily").call({ date: "2026-01-20" }, call))) as { date: string }[];
    expect(one[0]?.date).toBe("2026-01-20");
  });

  it("range wellness tools accept dates and cap the window", async () => {
    const reports = ctxFor("[]");
    await toolNamed(reports.ctx, "wellness_get_body_battery_reports").call({ dates: ["2026-01-10", "2026-01-12"] }, call);
    expect(reports.paths[0]).toBe("/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-01-10&endDate=2026-01-12");
    const scores = ctxFor(`[{"calendarDate":"2026-01-11","value":70,"qualifierKey":"FAIR"}]`);
    const rows = JSON.parse(textOf(await toolNamed(scores.ctx, "wellness_get_sleep_score_stats").call({ date: "2026-01-11" }, call))) as { date: string; value: number }[];
    expect(rows[0]).toMatchObject({ date: "2026-01-11", value: 70 });
    expect(scores.paths[0]).toBe("/wellness-service/stats/daily/sleep/score/2026-01-11/2026-01-11");
    const capped = await toolNamed(reports.ctx, "wellness_get_body_battery_reports").call({ end: "2026-02-15", start: "2026-01-01" }, call);
    expect(capped.isError).toBe(true);
    expect(textOf(capped)).toContain("date span exceeds 31 days");
  });

  it("activities_get_details accepts ids", async () => {
    const paths: string[] = [];
    const { ctx } = makeCtx({
      env: extendedEnv,
      fetch: scripted((url) => {
        paths.push(`${url.pathname}${url.search}`);
        return jsonResponse(200, JSON.stringify({ activityId: 1 }));
      }),
      token: authed(),
    });
    const rows = JSON.parse(textOf(await toolNamed(ctx, "activities_get_details").call({ ids: [3, 4] }, call))) as { activityId: number }[];
    expect(rows).toHaveLength(2);
    expect(paths.slice().sort()).toEqual([
      "/activity-service/activity/3/details",
      "/activity-service/activity/4/details",
    ]);
    const one = JSON.parse(textOf(await toolNamed(ctx, "activities_get_details").call({ activity_id: 5 }, call))) as unknown[];
    expect(one).toHaveLength(1);
  });
});

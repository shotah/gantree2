import { localParts } from "@/brain/core/clock";
import { parseDurationSeconds, type CivilDate, civilString } from "@/brain/plugins/google-health/civil";
import { asRecord, mathRound, sortedRecord, str } from "@/brain/plugins/google-health/wire";

export const sleepAPINote = "Google Health does not return the app Sleep Score (0-100). efficiency is round(minutes asleep / minutes in the sleep period * 100). stages_minutes are deep, light, rem, and awake.";

const sleepScoreKeys = ["sleepScore", "sleep_score", "score"];

export type SleepSession = {
  date: string;
  main: boolean;
  nap: boolean;
  durationMinutes: number;
  efficiency: number;
  minutesAwake: number;
  minutesInSleepPeriod: number;
  minutesToFallAsleep: number;
  minutesAfterWakeup: number;
  stagesMinutes: Record<string, number> | null;
  sleepScore: number | null;
  startTime: string;
  endTime: string;
  dataPointName: string;
};

export type SleepList = { sessions: SleepSession[]; count: number; note: string };

export type Activity = {
  id: string;
  name: string;
  activityType: string;
  startTime: string;
  durationMin: number;
  calories: number;
  steps: number;
  distanceKm: number;
};

export type ActivitiesList = { activities: Activity[]; count: number; nextPageToken: string; note: string };

export type HeartRateEntry = { date: string; restingHr: number };
export type HeartRateList = { entries: HeartRateEntry[]; count: number; note: string };

export type HrvEntry = { date: string; rmssd: number };
export type HrvList = { entries: HrvEntry[]; count: number; note: string };

export type Profile = { fitbitUser: string; googleUser: string; note: string };

export function parseFloatishPresent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    if (value.trim() === "") {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseFloatish(value: unknown): number {
  return parseFloatishPresent(value) ?? 0;
}

function boolField(record: Record<string, unknown> | null, key: string): boolean {
  return record?.[key] === true;
}

function strField(record: Record<string, unknown> | null, key: string): string {
  if (record === null) {
    return "";
  }
  return str(record[key]);
}

function dataPointName(point: Record<string, unknown>): string {
  const name = str(point.name);
  if (name !== "") {
    return name;
  }
  return str(point.dataPointName);
}

function formatAPIDate(date: Record<string, unknown> | null): string {
  if (date === null) {
    return "";
  }
  const year = Math.trunc(parseFloatish(date.year));
  const month = Math.trunc(parseFloatish(date.month));
  const day = Math.trunc(parseFloatish(date.day));
  if (year === 0 || month === 0 || day === 0) {
    return "";
  }
  const civil: CivilDate = { year, month, day };
  return civilString(civil);
}

function sessionWakeDay(interval: Record<string, unknown> | null, zone: string): string {
  const civil = asRecord(interval?.civilEndTime);
  const fromCivil = formatAPIDate(asRecord(civil?.date));
  if (fromCivil !== "") {
    return fromCivil;
  }
  const end = strField(interval, "endTime");
  if (end === "") {
    return "";
  }
  const ms = Date.parse(end);
  if (!Number.isFinite(ms)) {
    return "";
  }
  const parts = localParts(ms, zone);
  return civilString({ year: parts.year, month: parts.month, day: parts.day });
}

function lookupSleepScore(...objs: (Record<string, unknown> | null)[]): number | null {
  for (const record of objs) {
    if (record === null) {
      continue;
    }
    for (const key of sleepScoreKeys) {
      const score = parseFloatishPresent(record[key]);
      if (score !== null) {
        return score;
      }
    }
  }
  return null;
}

function mapStageMinutes(summary: Record<string, unknown> | null): Record<string, number> | null {
  const raw = summary?.stagesSummary;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const out: Record<string, number> = {};
  for (const item of raw) {
    const stage = asRecord(item);
    if (stage === null) {
      continue;
    }
    const type = strField(stage, "type").toLowerCase();
    if (type === "") {
      continue;
    }
    out[type] = parseFloatish(stage.minutes);
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function mapSleep(point: Record<string, unknown>, zone: string): SleepSession | null {
  const sleep = asRecord(point.sleep);
  if (sleep === null) {
    return null;
  }
  const interval = asRecord(sleep.interval);
  const summary = asRecord(sleep.summary);
  const meta = asRecord(sleep.metadata);
  const minutesAsleep = parseFloatish(summary?.minutesAsleep);
  const minutesInBed = parseFloatish(summary?.minutesInSleepPeriod);
  const efficiency = minutesInBed > 0 && minutesAsleep > 0 ? mathRound((minutesAsleep / minutesInBed) * 100) : 0;
  return {
    date: sessionWakeDay(interval, zone),
    main: boolField(meta, "mainSleep") || boolField(meta, "main"),
    nap: boolField(meta, "nap"),
    durationMinutes: minutesAsleep,
    efficiency,
    minutesAwake: parseFloatish(summary?.minutesAwake),
    minutesInSleepPeriod: minutesInBed,
    minutesToFallAsleep: parseFloatish(summary?.minutesToFallAsleep),
    minutesAfterWakeup: parseFloatish(summary?.minutesAfterWakeUp),
    stagesMinutes: mapStageMinutes(summary),
    sleepScore: lookupSleepScore(summary, sleep),
    startTime: strField(interval, "startTime"),
    endTime: strField(interval, "endTime"),
    dataPointName: dataPointName(point),
  };
}

export function mapSleepSessions(points: Record<string, unknown>[], zone: string): SleepSession[] {
  const out: SleepSession[] = [];
  for (const point of points) {
    const session = mapSleep(point, zone);
    if (session !== null) {
      out.push(session);
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.endTime < b.endTime ? -1 : a.endTime > b.endTime ? 1 : 0));
  return out;
}

function pathBase(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  if (trimmed === "") {
    return value.startsWith("/") ? "/" : ".";
  }
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

function firstNonEmpty(values: string[]): string {
  for (const value of values) {
    if (value.trim() !== "") {
      return value;
    }
  }
  return "";
}

export function mapExercise(point: Record<string, unknown>): Activity {
  const exercise = asRecord(point.exercise);
  const interval = asRecord(exercise?.interval);
  const metrics = asRecord(exercise?.metricsSummary);
  const name = dataPointName(point);
  const shortId = pathBase(name);
  let durationMin = parseDurationSeconds(strField(exercise, "activeDuration")) / 60;
  if (durationMin === 0) {
    const start = Date.parse(strField(interval, "startTime"));
    const end = Date.parse(strField(interval, "endTime"));
    if (Number.isFinite(start) && Number.isFinite(end)) {
      durationMin = (end - start) / 60000;
    }
  }
  return {
    id: firstNonEmpty([name, shortId]),
    name: strField(exercise, "displayName"),
    activityType: strField(exercise, "exerciseType"),
    startTime: strField(interval, "startTime"),
    durationMin,
    calories: parseFloatish(metrics?.caloriesKcal),
    steps: parseFloatish(metrics?.steps),
    distanceKm: parseFloatish(metrics?.distanceMillimeters) / 1_000_000,
  };
}

export function mapRestingHRList(points: Record<string, unknown>[], truncated: boolean): HeartRateList {
  const entries: HeartRateEntry[] = [];
  for (const point of points) {
    const daily = asRecord(point.dailyRestingHeartRate);
    if (daily === null) {
      continue;
    }
    entries.push({
      date: formatAPIDate(asRecord(daily.date)),
      restingHr: parseFloatish(daily.beatsPerMinute),
    });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let note = "daily-resting-heart-rate via reconcile";
  if (entries.length === 0) {
    note = "no daily resting heart rate in range";
  }
  if (truncated) {
    note = `truncated; narrow after_date/before_date. ${note}`;
  }
  return { entries, count: entries.length, note };
}

export function mapHRVList(points: Record<string, unknown>[], truncated: boolean): HrvList {
  const entries: HrvEntry[] = [];
  for (const point of points) {
    const daily = asRecord(point.dailyHeartRateVariability);
    if (daily === null) {
      continue;
    }
    let rmssd = parseFloatish(daily.averageHeartRateVariabilityMilliseconds);
    if (rmssd === 0) {
      rmssd = parseFloatish(daily.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds);
    }
    entries.push({ date: formatAPIDate(asRecord(daily.date)), rmssd });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let note = "daily-heart-rate-variability via reconcile";
  if (entries.length === 0) {
    note = "no daily HRV in range";
  }
  if (truncated) {
    note = `truncated; narrow after_date/before_date. ${note}`;
  }
  return { entries, count: entries.length, note };
}

export function mapWeightEntries(points: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const point of points) {
    const weight = asRecord(point.weight);
    const grams = parseFloatish(weight?.weightGrams);
    const sample = asRecord(weight?.sampleTime);
    const entry: Record<string, unknown> = {
      data_point_name: dataPointName(point),
      weight_kg: grams / 1000,
      weight_grams: grams,
      physical_time: strField(sample, "physicalTime"),
      notes: strField(weight, "notes"),
    };
    const civil = asRecord(sample?.civilTime);
    const date = formatAPIDate(asRecord(civil?.date));
    if (civil !== null && date !== "") {
      entry.date = date;
    }
    out.push(sortedRecord(entry));
  }
  return out;
}

function omitNum(out: Record<string, unknown>, key: string, value: number): void {
  if (value !== 0) {
    out[key] = value;
  }
}

function omitStr(out: Record<string, unknown>, key: string, value: string): void {
  if (value !== "") {
    out[key] = value;
  }
}

export function sleepJSON(session: SleepSession): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  omitStr(out, "date", session.date);
  out.main = session.main;
  if (session.nap) {
    out.nap = true;
  }
  omitNum(out, "duration_minutes", session.durationMinutes);
  omitNum(out, "efficiency", session.efficiency);
  omitNum(out, "minutes_awake", session.minutesAwake);
  omitNum(out, "minutes_in_sleep_period", session.minutesInSleepPeriod);
  omitNum(out, "minutes_to_fall_asleep", session.minutesToFallAsleep);
  omitNum(out, "minutes_after_wakeup", session.minutesAfterWakeup);
  if (session.stagesMinutes !== null) {
    const stages: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(session.stagesMinutes)) {
      stages[key] = value;
    }
    out.stages_minutes = sortedRecord(stages);
  }
  if (session.sleepScore !== null) {
    out.sleep_score = session.sleepScore;
  }
  omitStr(out, "start_time", session.startTime);
  omitStr(out, "end_time", session.endTime);
  omitStr(out, "data_point_name", session.dataPointName);
  return out;
}

export function sleepListJSON(result: SleepList): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sessions: result.sessions.map(sleepJSON),
    count: result.count,
  };
  omitStr(out, "note", result.note);
  return out;
}

export function activityJSON(activity: Activity): Record<string, unknown> {
  const out: Record<string, unknown> = { id: activity.id };
  omitStr(out, "name", activity.name);
  omitStr(out, "activity_type", activity.activityType);
  omitStr(out, "start_time", activity.startTime);
  omitNum(out, "duration_minutes", activity.durationMin);
  omitNum(out, "calories", activity.calories);
  omitNum(out, "steps", activity.steps);
  omitNum(out, "distance_km", activity.distanceKm);
  return out;
}

export function activitiesListJSON(result: ActivitiesList): Record<string, unknown> {
  const out: Record<string, unknown> = {
    activities: result.activities.map(activityJSON),
    count: result.count,
  };
  omitStr(out, "next_page_token", result.nextPageToken);
  omitStr(out, "note", result.note);
  return out;
}

export function heartRateListJSON(result: HeartRateList): Record<string, unknown> {
  return {
    entries: result.entries.map((entry) => {
      const out: Record<string, unknown> = {};
      omitStr(out, "date", entry.date);
      omitNum(out, "resting_hr", entry.restingHr);
      return out;
    }),
    count: result.count,
    ...(result.note === "" ? {} : { note: result.note }),
  };
}

export function hrvListJSON(result: HrvList): Record<string, unknown> {
  return {
    entries: result.entries.map((entry) => {
      const out: Record<string, unknown> = {};
      omitStr(out, "date", entry.date);
      omitNum(out, "rmssd", entry.rmssd);
      return out;
    }),
    count: result.count,
    ...(result.note === "" ? {} : { note: result.note }),
  };
}

export function weightJSON(entries: Record<string, unknown>[], note: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entries.length > 0) {
    out.entries = entries;
  }
  omitStr(out, "note", note);
  return out;
}

export function profileJSON(profile: Profile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  omitStr(out, "fitbit_user_id", profile.fitbitUser);
  omitStr(out, "google_user_id", profile.googleUser);
  omitStr(out, "note", profile.note);
  return out;
}

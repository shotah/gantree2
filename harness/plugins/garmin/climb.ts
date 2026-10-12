import { GarminError, isRecord } from "./json";

/** ClimbGradeValue.Display. */
export function climbGradeDisplay(v: unknown): string {
  if (v == null || !isRecord(v)) return "";
  const valueKey = typeof v.valueKey === "string" ? v.valueKey : "";
  const scale = typeof v.scale === "string" ? v.scale : "";
  if (valueKey === "") return "";
  switch (scale.toUpperCase()) {
    case "VERMIN":
      return valueKey;
    case "YDS": {
      const key = valueKey.startsWith("_") ? valueKey.slice(1) : valueKey;
      const cut = key.indexOf("_");
      if (cut >= 0) return `${key.slice(0, cut)}.${key.slice(cut + 1).toLowerCase()}`;
      return key;
    }
    case "FONT":
      return `Font ${valueKey.startsWith("_") ? valueKey.slice(1) : valueKey}`;
    default:
      if (scale === "") return valueKey;
      return `${scale}:${valueKey}`;
  }
}

function asNum(v: unknown, into: string): number {
  if (v === undefined) return 0;
  if (typeof v === "number") return v;
  throw new GarminError(`json: cannot unmarshal into ${into}`);
}

function asStr(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v !== "string") throw new GarminError("json: cannot unmarshal into string");
  return v;
}

function asInt(v: unknown): number {
  return Math.trunc(asNum(v, "int"));
}

/** Activity.ToListItem — the activities_list payload. */
export function toListItem(raw: unknown): Record<string, unknown> {
  if (raw === null) throw new GarminError("json: cannot unmarshal null into Go value of type garmin.Activity");
  const o = isRecord(raw) ? raw : {};
  if (o.activityType === null) throw new GarminError("json: cannot unmarshal null into Go value of type garmin.ActivityType");
  const type = isRecord(o.activityType) ? o.activityType : {};
  const item: Record<string, unknown> = {
    activityId: asInt(o.activityId),
    activityName: asStr(o.activityName),
    startTimeLocal: asStr(o.startTimeLocal),
    activityType: asStr(type.typeKey),
    distance: asNum(o.distance, "float64"),
    duration: asNum(o.duration, "float64"),
    calories: asNum(o.calories, "float64"),
  };
  const hr = asNum(o.averageHR, "float64");
  if (hr !== 0) item.averageHR = hr;
  const elev = asNum(o.elevationGain, "float64");
  if (elev !== 0) item.elevationGain = elev;
  const loc = asStr(o.locationName);
  if (loc !== "") item.locationName = loc;
  if (o.splitSummaries != null) {
    if (!Array.isArray(o.splitSummaries)) throw new GarminError("json: cannot unmarshal into slice");
    for (const split of o.splitSummaries) {
      if (!isRecord(split) || split.splitType !== "CLIMB_ACTIVE") continue;
      const falls = asInt(split.numFalls);
      const sends = asInt(split.numClimbSends);
      const done = asInt(split.numClimbsCompleted);
      if (falls !== 0) item.numFalls = falls;
      if (sends !== 0) item.numClimbSends = sends;
      if (done !== 0) item.numClimbsCompleted = done;
      const grade = climbGradeDisplay(split.maxGradeValue);
      if (grade !== "") item.maxClimbGrade = grade;
      break;
    }
  }
  return item;
}

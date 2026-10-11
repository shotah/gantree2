/**
 * Strava plugin. Tool names, descriptions, and input schemas match the Go
 * server's tools/list (mcp-go object schema, `required: []` when nothing is
 * required). Update/self-update tools are not published.
 */
import { errorResult, textResult, type CallContext, type JsonSchema, type Plugin, type PluginContext, type Tool, type ToolResult } from "@/brain/core/tools";
import type { StravaClient } from "./client.ts";
import { clientFor } from "./client.ts";
import { descriptions } from "./descriptions.ts";
import { asArray, errorMessage, failureText, FETCH_CAP, formatResponse, getBool, getInt, ID_CAP, isRecord, mapPool, parseJsonBody, toolError } from "./helpers.ts";
import { authFinish, authStart, ensureSchema } from "./oauth.ts";
import { uploadsCreateError } from "./uploads.ts";
import { apiPath, resolveStravaUrl } from "./urls.ts";

const streamTypes = [
  "time",
  "latlng",
  "distance",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
  "moving",
  "grade_smooth",
] as const;

function stringProp(description: string): JsonSchema {
  return { description, type: "string" };
}

function numberProp(description: string): JsonSchema {
  return { description, type: "number" };
}

function boolProp(description: string): JsonSchema {
  return { description, type: "boolean" };
}

/** Property names sort the way `encoding/json` marshals a Go map. `required` stays in declaration order. */
function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  const sorted: Record<string, JsonSchema> = {};
  for (const key of Object.keys(properties).sort()) {
    const property = properties[key];
    if (property) sorted[key] = property;
  }
  return { properties: sorted, required, type: "object" };
}

const pageProps = {
  page: numberProp("Page number (default: 1)"),
  per_page: numberProp("Number of items per page (1-200, default 30)"),
};

const idsNote = `Pass id or ids (max ${ID_CAP}) to fetch several in one call. Returns a list.`;
const urlsNote = "Pass url or urls (max 8) to resolve several links in one call. Returns a list.";

function idsProp(): JsonSchema {
  return {
    description: `Ids to fetch together (max ${ID_CAP}). id is also accepted.`,
    items: { type: "number" },
    type: "array",
  };
}

export const strava: Plugin = {
  name: "strava",

  async ready(ctx) {
    ensureSchema(ctx.sql);
    const clientId = ctx.env.STRAVA_CLIENT_ID ?? "";
    const clientSecret = ctx.env.STRAVA_CLIENT_SECRET ?? "";
    if (clientId === "" || clientSecret === "") return "no_key";
    const token = await ctx.tokens.get("strava");
    if (!token?.accessToken) return "no_oauth";
    return null;
  },

  tools(ctx) {
    ensureSchema(ctx.sql);
    return [
      tool(ctx, "activities_list", descriptions.activities_list, objectSchema({
        after: numberProp("Epoch timestamp to retrieve activities after (inclusive). Use this to find recent activities."),
        before: numberProp("Epoch timestamp to retrieve activities before (exclusive)"),
        ...pageProps,
      }), listActivities),
      tool(ctx, "activities_get", `${descriptions.activities_get} ${idsNote}`, objectSchema({
        id: numberProp("The ID of the activity"),
        ids: idsProp(),
        include_all_efforts: boolProp("Include all segment efforts (default: false)"),
      }), getActivity),
      tool(ctx, "activities_create", descriptions.activities_create, objectSchema({
        commute: boolProp("Whether this was a commute"),
        description: stringProp("Description of the activity"),
        distance: numberProp("Distance in meters"),
        elapsed_time: numberProp("Total elapsed time in seconds"),
        name: stringProp("The name of the activity"),
        sport_type: stringProp("Sport type: Run, TrailRun, Walk, Hike, Ride, MountainBikeRide, GravelRide, VirtualRide, Swim, etc."),
        start_date_local: stringProp("ISO 8601 formatted date time (e.g., 2024-01-13T06:00:00Z)"),
        trainer: boolProp("Whether this was a trainer/indoor activity"),
        type: stringProp("Legacy activity type (deprecated, use sport_type)"),
      }, ["name", "sport_type", "start_date_local", "elapsed_time"]), createActivity, "creates one activity"),
      tool(ctx, "activities_update", descriptions.activities_update, objectSchema({
        commute: boolProp("Mark as commute"),
        description: stringProp("Detailed description with training notes, weather, effort, feelings, route details, etc."),
        gear_id: stringProp("ID of the gear (shoes, bike) used"),
        hide_from_home: boolProp("Hide from home feed"),
        id: numberProp("The ID of the activity to update"),
        name: stringProp("New activity name/title"),
        sport_type: stringProp("Sport type: Run, TrailRun, Walk, Hike, VirtualRun, Ride, MountainBikeRide, etc."),
        trainer: boolProp("Mark as trainer/indoor activity"),
        type: stringProp("Legacy activity type (deprecated, use sport_type)"),
      }, ["id"]), updateActivity, "updates one activity"),
      tool(ctx, "activities_get_zones", `${descriptions.activities_get_zones} ${idsNote}`, objectSchema({
        id: numberProp("The ID of the activity"),
        ids: idsProp(),
      }), getZones),
      tool(ctx, "athlete_get", descriptions.athlete_get, objectSchema({}), getAthlete, "the authenticated athlete"),
      tool(ctx, "athlete_get_stats", descriptions.athlete_get_stats, objectSchema({
        id: numberProp("Athlete ID (optional - defaults to authenticated athlete)"),
      }), getStats, "stats for one athlete"),
      tool(ctx, "activities_get_streams", `${descriptions.activities_get_streams} ${idsNote}`, objectSchema({
        id: numberProp("The ID of the activity"),
        ids: idsProp(),
        key_by_type: boolProp("Return streams as an object keyed by type (default: true)"),
        keys: {
          description: "Array of stream types to retrieve: time, latlng, distance, altitude, velocity_smooth, heartrate, cadence, watts, temp, moving, grade_smooth. Omit to get all available streams.",
          items: { enum: [...streamTypes], type: "string" },
          type: "array",
        },
      }), getStreams),
      tool(ctx, "clubs_list_activities", `${descriptions.clubs_list_activities} ${idsNote}`, objectSchema({
        id: numberProp("The ID of the club"),
        ids: idsProp(),
        ...pageProps,
      }), listClubActivities),
      tool(ctx, "uploads_create", descriptions.uploads_create, objectSchema({
        commute: boolProp("Whether this is a commute"),
        data_type: stringProp("File format override: fit, fit.gz, tcx, tcx.gz, gpx, gpx.gz. Auto-detected from extension if omitted."),
        description: stringProp("Desired activity description"),
        external_id: stringProp("External identifier for the upload"),
        file: stringProp("Local file path to the activity file (.fit, .tcx, .gpx, or gzip compressed variants)"),
        name: stringProp("Desired activity name"),
        trainer: boolProp("Whether performed on a trainer"),
      }, ["file"]), createUpload, "uploads one activity file"),
      tool(ctx, "uploads_get", `${descriptions.uploads_get} ${idsNote}`, objectSchema({
        id: numberProp("The ID of the upload"),
        ids: idsProp(),
      }), getUpload),
      tool(ctx, "routes_list", `${descriptions.routes_list} Pass id or ids (max ${ID_CAP}) to list routes for several athletes in one call. Returns a list.`, objectSchema({
        id: numberProp("Athlete ID (optional - defaults to authenticated athlete)"),
        ids: idsProp(),
        ...pageProps,
      }), listRoutes),
      tool(ctx, "routes_get", `${descriptions.routes_get} ${idsNote}`, objectSchema({
        id: numberProp("The ID of the route"),
        ids: idsProp(),
      }), getRoute),
      tool(ctx, "urls_resolve", `${descriptions.urls_resolve} ${urlsNote}`, objectSchema({
        fetch: boolProp("Fetch the resolved resource from the Strava API (default: true)"),
        url: stringProp("Strava URL or strava.app.link short link"),
        urls: {
          description: "Strava URLs or strava.app.link short links (max 8). url is also accepted.",
          items: { type: "string" },
          type: "array",
        },
      }), resolveUrl),
    ];
  },

  authStart,
  authFinish,
};

type Handler = (args: Record<string, unknown>, callCtx: CallContext, client: StravaClient, ctx: PluginContext) => Promise<ToolResult>;

function tool(ctx: PluginContext, name: string, description: string, inputSchema: JsonSchema, handler: Handler, single?: string): Tool {
  return {
    name,
    description,
    inputSchema,
    ...(single ? { single } : {}),
    async call(args, callCtx) {
      try {
        return await handler(args, callCtx, clientFor(ctx), ctx);
      } catch (err) {
        return toolError(name, err);
      }
    },
  };
}

function done(client: StravaClient, data: string): ToolResult {
  return textResult(formatResponse(data, client.rateLimitWarning()));
}

function requireId(args: Record<string, unknown>, toolName: string): number | ToolResult {
  const id = getInt(args, "id", 0);
  if (id === 0) return errorResult(`${toolName}: id is required`);
  return id;
}

function readId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const id = Math.trunc(value);
    return id === 0 ? null : id;
  }
  if (typeof value === "string" && /^[+-]?\d+$/.test(value)) {
    const id = Number(value);
    return id === 0 ? null : id;
  }
  return null;
}

/** `id` and/or `ids`. Missing both keeps the Go "id is required" error. */
function resolveIds(args: Record<string, unknown>, toolName: string): number[] | ToolResult {
  const ids: number[] = [];
  if (Object.hasOwn(args, "id") && args.id != null && args.id !== "") {
    const id = readId(args.id);
    if (id === null) return errorResult(`${toolName}: id is required`);
    ids.push(id);
  }
  if (Object.hasOwn(args, "ids") && args.ids != null) {
    const raw = asArray(args.ids);
    if (!raw) return errorResult(`${toolName}: ids must be a list of ids`);
    for (const item of raw) {
      const id = readId(item);
      if (id === null) return errorResult(`${toolName}: ids must be a list of ids`);
      ids.push(id);
    }
  }
  if (ids.length === 0) return errorResult(`${toolName}: id is required`);
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length > ID_CAP) return errorResult(`${toolName}: ids accepts at most ${ID_CAP}`);
  return unique;
}

/** One object per id. A single unparsable body stays raw, matching formatResponse. */
async function fetchIds(
  client: StravaClient,
  toolName: string,
  ids: number[],
  load: (id: number) => Promise<string>,
): Promise<ToolResult> {
  const only = ids.length === 1 ? ids[0] : undefined;
  if (only !== undefined) {
    const data = await load(only);
    try {
      return done(client, JSON.stringify([parseJsonBody(data)]));
    } catch {
      return done(client, data);
    }
  }
  const rows = await mapPool(ids, FETCH_CAP, async (id) => {
    try {
      return parseJsonBody(await load(id));
    } catch (err) {
      return { error: failureText(toolName, err), id };
    }
  });
  return done(client, JSON.stringify(rows));
}

function flattenLists(rows: unknown[]): unknown[] {
  const flat: unknown[] = [];
  for (const row of rows) {
    if (Array.isArray(row)) {
      for (const item of row) flat.push(item);
    } else flat.push(row);
  }
  return flat;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function positiveParams(args: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of keys) {
    const value = getInt(args, key, 0);
    if (value !== 0) params[key] = String(value);
  }
  return params;
}

function copyFields(args: Record<string, unknown>, fields: readonly string[], body: Record<string, unknown>): void {
  for (const field of fields) {
    if (Object.hasOwn(args, field)) body[field] = args[field];
  }
}

async function authenticatedAthleteId(client: StravaClient, signal?: AbortSignal): Promise<number> {
  const data = await client.get("/athlete", undefined, signal);
  let profile: unknown;
  try {
    profile = JSON.parse(data);
  } catch (err) {
    throw new Error(`parse athlete profile: ${errorMessage(err)}`, { cause: err });
  }
  const id = isRecord(profile) && typeof profile.id === "number" && Number.isInteger(profile.id) ? profile.id : 0;
  if (id === 0) throw new Error("parse athlete profile: missing id");
  return id;
}

async function listActivities(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const data = await client.get("/athlete/activities", positiveParams(args, ["before", "after", "page", "per_page"]), callCtx.signal);
  return done(client, data);
}

async function getActivity(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const ids = resolveIds(args, "activities_get");
  if (!Array.isArray(ids)) return ids;
  const params: Record<string, string> = {};
  if (getBool(args, "include_all_efforts", false)) params.include_all_efforts = "true";
  return fetchIds(client, "activities_get", ids, (id) => client.get(`/activities/${id}`, params, callCtx.signal));
}

async function createActivity(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const name = stringArg(args, "name");
  if (name === "") return errorResult("activities_create: name is required");
  const sportType = stringArg(args, "sport_type");
  if (sportType === "") return errorResult("activities_create: sport_type is required");
  const start = stringArg(args, "start_date_local");
  if (start === "") return errorResult("activities_create: start_date_local is required");
  const elapsed = getInt(args, "elapsed_time", 0);
  if (elapsed === 0) return errorResult("activities_create: elapsed_time is required");
  const body: Record<string, unknown> = {
    elapsed_time: elapsed,
    name,
    sport_type: sportType,
    start_date_local: start,
  };
  copyFields(args, ["type", "description", "distance", "trainer", "commute"], body);
  const data = await client.post("/activities", body, callCtx.signal);
  return done(client, data);
}

async function updateActivity(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const id = requireId(args, "activities_update");
  if (typeof id !== "number") return id;
  const body: Record<string, unknown> = {};
  copyFields(args, ["name", "type", "sport_type", "description", "gear_id", "trainer", "commute", "hide_from_home"], body);
  const data = await client.put(`/activities/${id}`, body, callCtx.signal);
  return done(client, data);
}

async function getZones(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const ids = resolveIds(args, "activities_get_zones");
  if (!Array.isArray(ids)) return ids;
  return fetchIds(client, "activities_get_zones", ids, (id) => client.get(`/activities/${id}/zones`, undefined, callCtx.signal));
}

async function getAthlete(_args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const data = await client.get("/athlete", undefined, callCtx.signal);
  return done(client, data);
}

async function getStats(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  let athleteId = getInt(args, "id", 0);
  if (athleteId === 0) athleteId = await authenticatedAthleteId(client, callCtx.signal);
  const data = await client.get(`/athletes/${athleteId}/stats`, undefined, callCtx.signal);
  return done(client, data);
}

async function getStreams(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const ids = resolveIds(args, "activities_get_streams");
  if (!Array.isArray(ids)) return ids;
  const params: Record<string, string> = {};
  const keys = streamKeyParam(args);
  if (keys !== undefined) params.keys = keys;
  params.key_by_type = String(getBool(args, "key_by_type", true));
  return fetchIds(client, "activities_get_streams", ids, (id) => client.get(`/activities/${id}/streams`, params, callCtx.signal));
}

function streamKeyParam(args: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(args, "keys")) return streamTypes.join(",");
  const value = asArray(args.keys);
  if (!value) return undefined;
  const keys: string[] = [];
  for (const item of value) {
    if (typeof item === "string") keys.push(item);
  }
  return keys.join(",");
}

async function listClubActivities(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const ids = resolveIds(args, "clubs_list_activities");
  if (!Array.isArray(ids)) return ids;
  const params = positiveParams(args, ["page", "per_page"]);
  if (ids.length === 1) {
    const id = ids[0];
    if (id === undefined) return errorResult("clubs_list_activities: id is required");
    return done(client, await client.get(`/clubs/${id}/activities`, params, callCtx.signal));
  }
  const rows = await mapPool(ids, FETCH_CAP, async (id) => {
    try {
      return parseJsonBody(await client.get(`/clubs/${id}/activities`, params, callCtx.signal));
    } catch (err) {
      return { error: failureText("clubs_list_activities", err), id };
    }
  });
  return done(client, JSON.stringify(flattenLists(rows)));
}

function createUpload(args: Record<string, unknown>): Promise<ToolResult> {
  return Promise.resolve(errorResult(uploadsCreateError(args)));
}

async function getUpload(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const ids = resolveIds(args, "uploads_get");
  if (!Array.isArray(ids)) return ids;
  return fetchIds(client, "uploads_get", ids, (id) => client.get(`/uploads/${id}`, undefined, callCtx.signal));
}

async function listRoutes(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const explicit = Object.hasOwn(args, "ids") || (Object.hasOwn(args, "id") && args.id != null && args.id !== "")
    ? resolveIds(args, "routes_list")
    : [];
  if (!Array.isArray(explicit)) return explicit;
  const params = positiveParams(args, ["page", "per_page"]);
  const ids = explicit.length > 0 ? explicit : [await authenticatedAthleteId(client, callCtx.signal)];
  if (ids.length === 1) {
    const id = ids[0];
    if (id === undefined) return errorResult("routes_list: id is required");
    return done(client, await client.get(`/athletes/${id}/routes`, params, callCtx.signal));
  }
  const rows = await mapPool(ids, FETCH_CAP, async (id) => {
    try {
      return parseJsonBody(await client.get(`/athletes/${id}/routes`, params, callCtx.signal));
    } catch (err) {
      return { error: failureText("routes_list", err), id };
    }
  });
  return done(client, JSON.stringify(flattenLists(rows)));
}

async function getRoute(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient): Promise<ToolResult> {
  const ids = resolveIds(args, "routes_get");
  if (!Array.isArray(ids)) return ids;
  return fetchIds(client, "routes_get", ids, (id) => client.get(`/routes/${id}`, undefined, callCtx.signal));
}

const URL_CAP = 8;

function resolveUrls(args: Record<string, unknown>): string[] | ToolResult {
  const urls: string[] = [];
  const one = stringArg(args, "url");
  if (one !== "") urls.push(one);
  if (Object.hasOwn(args, "urls") && args.urls != null) {
    const raw = asArray(args.urls);
    if (!raw) return errorResult("urls_resolve: urls must be a list of urls");
    for (const item of raw) {
      if (typeof item !== "string" || item === "") return errorResult("urls_resolve: urls must be a list of urls");
      urls.push(item);
    }
  }
  if (urls.length === 0) return errorResult("urls_resolve: url is required");
  if (urls.length > URL_CAP) return errorResult(`urls_resolve: urls accepts at most ${URL_CAP}`);
  return urls;
}

async function oneResolved(raw: string, fetchResource: boolean, callCtx: CallContext, client: StravaClient, ctx: PluginContext): Promise<Record<string, unknown>> {
  const resolved = await resolveStravaUrl(raw, { fetch: ctx.fetch, signal: callCtx.signal });
  const out: Record<string, unknown> = {
    canonical_url: resolved.canonicalUrl,
    id: resolved.id,
    input_url: resolved.inputUrl,
    type: resolved.type,
  };
  if (fetchResource) {
    const data = await client.get(apiPath(resolved), undefined, callCtx.signal);
    let resource: unknown;
    try {
      resource = parseJsonBody(data);
    } catch (err) {
      throw new Error(errorMessage(err), { cause: err });
    }
    if (resource !== null) out.resource = resource;
  }
  return out;
}

async function resolveUrl(args: Record<string, unknown>, callCtx: CallContext, client: StravaClient, ctx: PluginContext): Promise<ToolResult> {
  const urls = resolveUrls(args);
  if (!Array.isArray(urls)) return urls;
  const fetchResource = getBool(args, "fetch", true);
  const rows = await mapPool(urls, FETCH_CAP, async (raw) => {
    try {
      return await oneResolved(raw, fetchResource, callCtx, client, ctx);
    } catch (err) {
      return { error: failureText("urls_resolve", err), input_url: raw };
    }
  });
  return done(client, JSON.stringify(rows));
}

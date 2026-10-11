import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink, nodeSql, type NodeDatabase } from "@/brain/core";
import type { CallContext, OAuthToken, PluginContext, ToolResult } from "@/brain/core/tools";
import { strava } from "@/brain/plugins/strava";
import { clientFor } from "@/brain/plugins/strava/client";
import { exchangeCode, generatePkce, stravaScopes } from "@/brain/plugins/strava/oauth";

const call: CallContext = { sessionId: "s", userId: "u" };
const now = 1_700_000_000_000;

function textOf(result: ToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("expected text");
  return first.text;
}

function urlOf(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { headers, status });
}

type Seen = { url: URL; method: string; headers: Headers; body: string };

function harness(opts: {
  env?: Record<string, string>;
  token?: OAuthToken | null;
  fetch?: typeof fetch;
  failPut?: boolean;
  at?: number;
} = {}) {
  const sink = memorySink();
  const clock = fixedClock(opts.at ?? now);
  let token = opts.token === undefined ? null : opts.token;
  const puts: OAuthToken[] = [];
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = urlOf(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    seen.push({ body, headers, method: init?.method ?? "GET", url });
    if (opts.fetch) return opts.fetch(input, init);
    return jsonResponse({ ok: true });
  };
  const ctx: PluginContext = {
    clock,
    env: opts.env ?? { STRAVA_CLIENT_ID: "client-id", STRAVA_CLIENT_SECRET: "super-secret-value" },
    fetch: fetchImpl,
    log: makeLogger(sink, () => clock.now()),
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    tokens: {
      async delete() {
        token = null;
      },
      async get() {
        return token;
      },
      async put(_provider, next) {
        if (opts.failPut) throw new Error("disk full");
        token = next;
        puts.push(next);
      },
    },
  };
  return { clock, ctx, puts, seen, sink, token: () => token };
}

async function callTool(ctx: PluginContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = strava.tools(ctx).find((item) => item.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.call(args, call);
}

const live = (at = now): OAuthToken => ({
  accessToken: "access-secret-token",
  expiresAt: at + 3_600_000,
  refreshToken: "refresh-secret-token",
});

describe("ready", () => {
  it("is no_key without both client credentials and no_oauth until a token exists", async () => {
    const missing = harness({ env: {} });
    expect(await strava.ready(missing.ctx)).toBe("no_key");
    const idOnly = harness({ env: { STRAVA_CLIENT_ID: "id" } });
    expect(await strava.ready(idOnly.ctx)).toBe("no_key");
    const secretOnly = harness({ env: { STRAVA_CLIENT_SECRET: "secret" } });
    expect(await strava.ready(secretOnly.ctx)).toBe("no_key");
    const noToken = harness();
    expect(await strava.ready(noToken.ctx)).toBe("no_oauth");
    const emptyAccess = harness({ token: { accessToken: "", expiresAt: now + 1000 } });
    expect(await strava.ready(emptyAccess.ctx)).toBe("no_oauth");
    const ready = harness({ token: live() });
    expect(await strava.ready(ready.ctx)).toBeNull();
  });
});

describe("tools/list", () => {
  it("publishes the Go catalog, not the self-update tools", () => {
    const { ctx } = harness();
    const tools = strava.tools(ctx);
    expect(tools.map((item) => item.name)).toEqual([
      "activities_list",
      "activities_get",
      "activities_create",
      "activities_update",
      "activities_get_zones",
      "athlete_get",
      "athlete_get_stats",
      "activities_get_streams",
      "clubs_list_activities",
      "uploads_create",
      "uploads_get",
      "routes_list",
      "routes_get",
      "urls_resolve",
    ]);
    expect(tools.some((item) => item.name === "utility_check_update" || item.name === "utility_self_update")).toBe(false);
    const byName = Object.fromEntries(tools.map((item) => [item.name, item]));
    expect(byName.activities_list?.description.startsWith("Retrieves the authenticated athlete's activities.")).toBe(true);
    expect(byName.activities_update?.description.startsWith("**[CRITICAL - PRIMARY ENRICHMENT TOOL]**")).toBe(true);
    expect(byName.urls_resolve?.description.startsWith("Resolves a Strava URL — including shortened")).toBe(true);
    expect(byName.activities_list?.inputSchema.required).toEqual([]);
    expect(byName.activities_get?.inputSchema.required).toEqual([]);
    expect(byName.activities_get?.inputSchema.properties).toMatchObject({ ids: { type: "array" } });
    expect(byName.activities_create?.inputSchema.required).toEqual(["name", "sport_type", "start_date_local", "elapsed_time"]);
    expect(byName.athlete_get?.inputSchema.properties).toEqual({});
    expect(byName.uploads_create?.inputSchema.required).toEqual(["file"]);
    expect(byName.urls_resolve?.inputSchema.required).toEqual([]);
    expect(byName.athlete_get?.single).toContain("athlete");
    expect(byName.activities_create?.single).toContain("one activity");
    expect(byName.uploads_create?.single).toContain("one activity file");
    const keys = byName.activities_get_streams?.inputSchema.properties;
    expect(keys && typeof keys === "object" && "keys" in keys ? keys.keys : {}).toMatchObject({
      items: { enum: ["time", "latlng", "distance", "altitude", "velocity_smooth", "heartrate", "cadence", "watts", "temp", "moving", "grade_smooth"], type: "string" },
      type: "array",
    });
    expect(Object.keys(byName.activities_list?.inputSchema.properties ?? {})).toEqual(["after", "before", "page", "per_page"]);
  });
});

describe("activities", () => {
  it("lists, filters, and pretty-prints", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        expect(url.pathname).toBe("/api/v3/athlete/activities");
        expect(url.searchParams.get("per_page")).toBe("10");
        return Promise.resolve(jsonResponse([{ id: 1, name: "Morning Run" }]));
      },
      token: live(),
    });
    const result = await callTool(h.ctx, "activities_list", { per_page: 10 });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Morning Run");
    expect(textOf(result)).toContain("  \"name\"");
    expect(h.seen[0]?.method).toBe("GET");
    expect(h.seen[0]?.headers.get("authorization")).toBe("Bearer access-secret-token");
  });

  it("sends before and after when they are non-zero", async () => {
    const h = harness({ token: live() });
    await callTool(h.ctx, "activities_list", { after: 1690000000, before: 1700000000 });
    const query = h.seen[0]?.url.search ?? "";
    expect(query).toContain("before=1700000000");
    expect(query).toContain("after=1690000000");
  });

  it("gets one activity and includes efforts only when asked", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 123, name: "Afternoon Run" })),
      token: live(),
    });
    const result = await callTool(h.ctx, "activities_get", { id: 123 });
    expect(h.seen[0]?.url.pathname).toBe("/api/v3/activities/123");
    expect(h.seen[0]?.url.search).toBe("");
    expect(textOf(result)).toContain("Afternoon Run");
    await callTool(h.ctx, "activities_get", { id: 123, include_all_efforts: true });
    expect(h.seen[1]?.url.searchParams.get("include_all_efforts")).toBe("true");
    await callTool(h.ctx, "activities_get", { id: 123, include_all_efforts: false });
    expect(h.seen[2]?.url.search).toBe("");
  });

  it("requires an id and the create fields before calling strava", async () => {
    const h = harness({
      fetch: () => Promise.reject(new Error("called")),
      token: live(),
    });
    const missing = await callTool(h.ctx, "activities_get", {});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("id is required");
    const create = await callTool(h.ctx, "activities_create", { elapsed_time: 3600, sport_type: "Run", start_date_local: "2024-01-13T06:00:00Z" });
    expect(textOf(create)).toContain("name is required");
    expect(h.seen).toHaveLength(0);
  });

  it("creates and updates with only the provided fields", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 456, name: "Morning Run" }, 201)),
      token: live(),
    });
    const created = await callTool(h.ctx, "activities_create", {
      distance: 10000,
      elapsed_time: 3600,
      name: "Morning Run",
      sport_type: "Run",
      start_date_local: "2024-01-13T06:00:00Z",
    });
    expect(created.isError).toBeUndefined();
    expect(h.seen[0]?.method).toBe("POST");
    expect(h.seen[0]?.url.pathname).toBe("/api/v3/activities");
    expect(h.seen[0]?.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(h.seen[0]?.body ?? "{}")).toMatchObject({ distance: 10000, elapsed_time: 3600, name: "Morning Run", sport_type: "Run" });
    const updated = await callTool(h.ctx, "activities_update", { id: 123, name: "New Name" });
    expect(updated.isError).toBeUndefined();
    expect(h.seen[1]?.method).toBe("PUT");
    expect(h.seen[1]?.url.pathname).toBe("/api/v3/activities/123");
    expect(JSON.parse(h.seen[1]?.body ?? "{}")).toEqual({ name: "New Name" });
    const missing = await callTool(h.ctx, "activities_update", {});
    expect(textOf(missing)).toContain("id is required");
  });

  it("reads zones and surfaces a 403 as a tool error", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/zones")) return Promise.resolve(jsonResponse({ zones: [] }));
        return Promise.resolve(jsonResponse({ message: "Rate Limit Exceeded" }, 403));
      },
      token: live(),
    });
    const zones = await callTool(h.ctx, "activities_get_zones", { id: 9 });
    expect(textOf(zones)).toContain("zones");
    const denied = await callTool(h.ctx, "activities_list");
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain("activities_list: Strava API error (403):");
    expect(textOf(denied)).toContain("Rate Limit Exceeded");
  });
});

describe("athlete, streams, clubs, routes", () => {
  it("gets the athlete and stats, auto-fetching the id", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname === "/api/v3/athlete") return Promise.resolve(jsonResponse({ id: 42, firstname: "Ada" }));
        return Promise.resolve(jsonResponse({ all_run_totals: { count: 3 } }));
      },
      token: live(),
    });
    const profile = await callTool(h.ctx, "athlete_get");
    expect(h.seen[0]?.url.search).toBe("");
    expect(textOf(profile)).toContain("Ada");
    const explicit = await callTool(h.ctx, "athlete_get_stats", { id: 7 });
    expect(h.seen[1]?.url.pathname).toBe("/api/v3/athletes/7/stats");
    const auto = await callTool(h.ctx, "athlete_get_stats");
    expect(h.seen.map((item) => item.url.pathname).slice(2)).toEqual(["/api/v3/athlete", "/api/v3/athletes/42/stats"]);
    expect(textOf(auto)).toContain("all_run_totals");
    expect(explicit.isError).toBeUndefined();
  });

  it("reports a missing or unreadable athlete id", async () => {
    const bad = harness({
      fetch: () => Promise.resolve(jsonResponse({ name: "Sam" })),
      token: live(),
    });
    const missing = await callTool(bad.ctx, "athlete_get_stats");
    expect(textOf(missing)).toContain("parse athlete profile: missing id");
    const junk = harness({
      fetch: () => Promise.resolve(jsonResponse("not-json")),
      token: live(),
    });
    const parsed = await callTool(junk.ctx, "routes_list");
    expect(parsed.isError).toBe(true);
    expect(textOf(parsed)).toContain("routes_list: parse athlete profile:");
  });

  it("requests streams, defaulting keys and key_by_type", async () => {
    const h = harness({ token: live() });
    await callTool(h.ctx, "activities_get_streams", { id: 123, keys: ["heartrate", "time"] });
    expect(h.seen[0]?.url.pathname).toBe("/api/v3/activities/123/streams");
    expect(h.seen[0]?.url.searchParams.get("keys")).toBe("heartrate,time");
    expect(h.seen[0]?.url.search).toContain("heartrate%2Ctime");
    await callTool(h.ctx, "activities_get_streams", { id: 123 });
    const all = h.seen[1]?.url.searchParams.get("keys") ?? "";
    expect(all.split(",")).toEqual(["time", "latlng", "distance", "altitude", "velocity_smooth", "heartrate", "cadence", "watts", "temp", "moving", "grade_smooth"]);
    expect(h.seen[1]?.url.searchParams.get("key_by_type")).toBe("true");
    await callTool(h.ctx, "activities_get_streams", { id: 123, key_by_type: false, keys: "nope" });
    expect(h.seen[2]?.url.searchParams.has("keys")).toBe(false);
    expect(h.seen[2]?.url.searchParams.get("key_by_type")).toBe("false");
    const missing = await callTool(h.ctx, "activities_get_streams", {});
    expect(textOf(missing)).toContain("id is required");
    const denied = harness({
      fetch: () => Promise.resolve(jsonResponse({ message: "Rate Limit Exceeded" }, 403)),
      token: live(),
    });
    const error = await callTool(denied.ctx, "activities_get_streams", { id: 1 });
    expect(textOf(error)).toContain("Strava API error (403)");
  });

  it("lists club activities with pagination", async () => {
    const h = harness({ token: live() });
    await callTool(h.ctx, "clubs_list_activities", { id: 5, page: 2, per_page: 50 });
    expect(h.seen[0]?.url.pathname).toBe("/api/v3/clubs/5/activities");
    expect(h.seen[0]?.url.searchParams.get("page")).toBe("2");
    expect(h.seen[0]?.url.searchParams.get("per_page")).toBe("50");
    const missing = await callTool(h.ctx, "clubs_list_activities", {});
    expect(textOf(missing)).toContain("id is required");
  });

  it("lists and gets routes", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname === "/api/v3/athlete") return Promise.resolve(jsonResponse({ id: 42 }));
        return Promise.resolve(jsonResponse({ id: 9, name: "River Loop" }));
      },
      token: live(),
    });
    await callTool(h.ctx, "routes_list", { id: 3, page: 1 });
    expect(h.seen.map((item) => item.url.pathname)).toEqual(["/api/v3/athletes/3/routes"]);
    await callTool(h.ctx, "routes_list");
    expect(h.seen.map((item) => item.url.pathname).slice(1)).toEqual(["/api/v3/athlete", "/api/v3/athletes/42/routes"]);
    const route = await callTool(h.ctx, "routes_get", { id: 9 });
    expect(h.seen.at(-1)?.url.pathname).toBe("/api/v3/routes/9");
    expect(textOf(route)).toContain("River Loop");
    const missing = await callTool(h.ctx, "routes_get", {});
    expect(textOf(missing)).toContain("id is required");
  });
});

describe("uploads", () => {
  it("validates the extension and data_type, then cannot open a file", async () => {
    const h = harness({
      fetch: () => Promise.reject(new Error("called")),
      token: live(),
    });
    const txt = await callTool(h.ctx, "uploads_create", { file: "/tmp/notes.txt" });
    expect(textOf(txt)).toContain("unrecognized file extension 'txt'");
    const gz = await callTool(h.ctx, "uploads_create", { file: "/tmp/notes.gz" });
    expect(textOf(gz)).toContain("cannot detect data_type");
    const badType = await callTool(h.ctx, "uploads_create", { data_type: "exe", file: "/tmp/activity.gpx" });
    expect(textOf(badType)).toContain("invalid data_type 'exe'");
    const upper = await callTool(h.ctx, "uploads_create", { data_type: "FIT", file: "/tmp/activity.fit" });
    expect(textOf(upper)).toContain("invalid data_type 'FIT'");
    const missing = await callTool(h.ctx, "uploads_create", {});
    expect(textOf(missing)).toContain("file path is required");
    const fitGz = await callTool(h.ctx, "uploads_create", { file: "/tmp/ride.fit.gz" });
    expect(textOf(fitGz)).toContain("open file");
    const override = await callTool(h.ctx, "uploads_create", { data_type: "tcx", file: "/tmp/activity.gpx" });
    expect(textOf(override)).toContain("open file");
    expect(h.seen).toHaveLength(0);
    const status = await callTool(harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 9, status: "Your activity is ready." })),
      token: live(),
    }).ctx, "uploads_get", { id: 9 });
    expect(textOf(status)).toContain("Your activity is ready.");
    const noId = await callTool(h.ctx, "uploads_get", {});
    expect(textOf(noId)).toContain("id is required");
  });
});

describe("urls_resolve", () => {
  it("fetches the route and can skip the api", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 777, map: { summary_polyline: "abc" }, name: "River Loop" })),
      token: live(),
    });
    const fetched = await callTool(h.ctx, "urls_resolve", { url: "https://www.strava.com/routes/777" });
    expect(h.seen[0]?.url.pathname).toBe("/api/v3/routes/777");
    const text = textOf(fetched);
    expect(text).toContain("\"type\": \"route\"");
    expect(text).toContain("\"id\": 777");
    expect(text).toContain("River Loop");
    expect(text).toContain("summary_polyline");
    const skipped = await callTool(h.ctx, "urls_resolve", { fetch: false, url: "https://www.strava.com/activities/42" });
    expect(textOf(skipped)).toContain("\"type\": \"activity\"");
    expect(textOf(skipped)).not.toContain("\"resource\"");
    expect(h.seen).toHaveLength(1);
  });

  it("follows a short link before the api get", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.hostname === "strava.app.link") {
          return Promise.resolve(new Response(null, { status: 302, headers: { location: "https://www.strava.com/activities/99" } }));
        }
        return Promise.resolve(jsonResponse({ id: 99, name: "Morning Ride" }));
      },
      token: live(),
    });
    const result = await callTool(h.ctx, "urls_resolve", { url: "https://strava.app.link/abc" });
    expect(h.seen.map((item) => item.url.pathname)).toEqual(["/abc", "/api/v3/activities/99"]);
    expect(textOf(result)).toContain("Morning Ride");
  });

  it("reports a missing url, a foreign host, bad json, and a 403", async () => {
    const quiet = harness({ fetch: () => Promise.reject(new Error("called")), token: live() });
    const missing = await callTool(quiet.ctx, "urls_resolve", {});
    expect(textOf(missing)).toContain("url is required");
    const foreign = await callTool(quiet.ctx, "urls_resolve", { url: "https://evil.example/routes/1" });
    expect(foreign.isError).toBeUndefined();
    expect(textOf(foreign)).toContain("urls_resolve");
    const bad = harness({ fetch: () => Promise.resolve(jsonResponse("not-json")), token: live() });
    const badResult = await callTool(bad.ctx, "urls_resolve", { url: "https://www.strava.com/routes/1" });
    expect(badResult.isError).toBeUndefined();
    expect(textOf(badResult)).toContain("urls_resolve");
    const denied = harness({
      fetch: () => Promise.resolve(jsonResponse({ message: "Rate Limit Exceeded" }, 403)),
      token: live(),
    });
    expect(textOf(await callTool(denied.ctx, "urls_resolve", { url: "https://www.strava.com/routes/1" }))).toContain("403");
  });
});

describe("plural ids and urls", () => {
  it("activities_get accepts ids and still accepts id", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 1, name: "Run" })),
      token: live(),
    });
    const many = JSON.parse(textOf(await callTool(h.ctx, "activities_get", { ids: [1, 2] }))) as { id: number }[];
    expect(many).toHaveLength(2);
    expect(h.seen.map((item) => item.url.pathname).sort()).toEqual(["/api/v3/activities/1", "/api/v3/activities/2"]);
    const one = JSON.parse(textOf(await callTool(h.ctx, "activities_get", { id: 9, include_all_efforts: true }))) as { name: string }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.name).toBe("Run");
    expect(h.seen.at(-1)?.url.pathname).toBe("/api/v3/activities/9");
  });

  it("activities_get_zones accepts ids and keeps a failed id in the list", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/2/zones")) return Promise.resolve(jsonResponse({ message: "nope" }, 404));
        return Promise.resolve(jsonResponse({ zones: [] }));
      },
      token: live(),
    });
    const rows = JSON.parse(textOf(await callTool(h.ctx, "activities_get_zones", { ids: [1, 2] }))) as { error?: string; zones?: unknown[] }[];
    expect(rows[0]?.zones).toEqual([]);
    expect(rows[1]?.error).toContain("404");
    const one = JSON.parse(textOf(await callTool(h.ctx, "activities_get_zones", { id: 1 }))) as unknown[];
    expect(one).toHaveLength(1);
  });

  it("activities_get_streams accepts ids", async () => {
    const h = harness({ token: live() });
    await callTool(h.ctx, "activities_get_streams", { ids: [4, 5], keys: ["heartrate"] });
    expect(h.seen.map((item) => item.url.pathname).sort()).toEqual(["/api/v3/activities/4/streams", "/api/v3/activities/5/streams"]);
    expect(h.seen[0]?.url.searchParams.get("keys")).toBe("heartrate");
    const one = JSON.parse(textOf(await callTool(h.ctx, "activities_get_streams", { id: 4 }))) as unknown[];
    expect(one).toHaveLength(1);
  });

  it("routes_get and uploads_get accept ids", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 9, name: "Loop" })),
      token: live(),
    });
    const routes = JSON.parse(textOf(await callTool(h.ctx, "routes_get", { ids: [9, 10] }))) as { id: number }[];
    expect(routes).toHaveLength(2);
    expect(h.seen.map((item) => item.url.pathname).sort()).toEqual(["/api/v3/routes/10", "/api/v3/routes/9"]);
    const uploads = JSON.parse(textOf(await callTool(h.ctx, "uploads_get", { ids: [3] }))) as { id: number }[];
    expect(uploads).toHaveLength(1);
    expect(h.seen.at(-1)?.url.pathname).toBe("/api/v3/uploads/3");
    const one = JSON.parse(textOf(await callTool(h.ctx, "routes_get", { id: 9 }))) as { name: string }[];
    expect(one[0]?.name).toBe("Loop");
  });

  it("urls_resolve accepts urls and a single url", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 1, name: "A" })),
      token: live(),
    });
    const rows = JSON.parse(textOf(await callTool(h.ctx, "urls_resolve", {
      urls: ["https://www.strava.com/activities/1", "https://www.strava.com/routes/2"],
    }))) as { id: number; type: string }[];
    expect(rows.map((row) => row.type).sort()).toEqual(["activity", "route"]);
    expect(h.seen.map((item) => item.url.pathname).sort()).toEqual(["/api/v3/activities/1", "/api/v3/routes/2"]);
    const one = JSON.parse(textOf(await callTool(h.ctx, "urls_resolve", { url: "https://www.strava.com/activities/7" }))) as { type: string }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.type).toBe("activity");
  });

  it("clubs_list_activities and routes_list accept ids", async () => {
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname === "/api/v3/athlete") return Promise.resolve(jsonResponse({ id: 42 }));
        return Promise.resolve(jsonResponse([{ id: 1 }]));
      },
      token: live(),
    });
    const clubs = JSON.parse(textOf(await callTool(h.ctx, "clubs_list_activities", { ids: [5, 6] }))) as { id: number }[];
    expect(clubs).toHaveLength(2);
    expect(h.seen.map((item) => item.url.pathname).sort()).toEqual(["/api/v3/clubs/5/activities", "/api/v3/clubs/6/activities"]);
    const routes = JSON.parse(textOf(await callTool(h.ctx, "routes_list", { ids: [3, 4] }))) as { id: number }[];
    expect(routes).toHaveLength(2);
    const one = JSON.parse(textOf(await callTool(h.ctx, "clubs_list_activities", { id: 5 }))) as { id: number }[];
    expect(one[0]?.id).toBe(1);
  });
});

describe("rate limit notes", () => {
  it("appends a note above 80 percent and leaves invalid json raw", async () => {
    const high = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 1 }, 200, { "X-RateLimit-Limit": "100,1000", "X-RateLimit-Usage": "85,500" })),
      token: live(),
    });
    const warned = textOf(await callTool(high.ctx, "activities_get", { id: 1 }));
    expect(warned).toContain("Note: 85/100 API calls used in this 15-min window.");
    expect(high.sink.records.some((record) => record.level === "warn" && record.message === "approaching rate limit")).toBe(true);
    const low = harness({
      fetch: () => Promise.resolve(jsonResponse({ id: 1 }, 200, { "X-RateLimit-Limit": "100,1000", "X-RateLimit-Usage": "10,50" })),
      token: live(),
    });
    expect(textOf(await callTool(low.ctx, "activities_get", { id: 1 }))).not.toContain("API calls");
    const raw = harness({
      fetch: () => Promise.resolve(jsonResponse("not valid json at all", 200, { "X-RateLimit-Limit": "100,1000", "X-RateLimit-Usage": "85,500" })),
      token: live(),
    });
    expect(textOf(await callTool(raw.ctx, "activities_get", { id: 1 }))).toBe("not valid json at all");
  });
});

describe("oauth", () => {
  it("builds a PKCE authorize url and exchanges the code without redirect_uri", async () => {
    const pair = await generatePkce();
    expect(pair.verifier).toHaveLength(43);
    expect(pair.challenge).toHaveLength(43);
    expect(pair.challenge).toBe(createHash("sha256").update(pair.verifier).digest("base64url"));
    const other = await generatePkce();
    expect(other.verifier).not.toBe(pair.verifier);

    let challenge = "";
    const h = harness({
      fetch: (input, init) => {
        const url = urlOf(input);
        expect(url.pathname).toBe("/api/v3/oauth/token");
        const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
        expect(form.get("grant_type")).toBe("authorization_code");
        expect(form.get("code")).toBe("auth-code");
        expect(form.get("client_id")).toBe("client-id");
        expect(form.get("client_secret")).toBe("super-secret-value");
        expect(form.get("code_verifier")).toBeTruthy();
        expect(form.has("redirect_uri")).toBe(false);
        const verifier = form.get("code_verifier") ?? "";
        expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
        return Promise.resolve(jsonResponse({
          access_token: "new-access",
          expires_at: 1_700_000_100,
          refresh_token: "new-refresh",
          token_type: "Bearer",
        }));
      },
    });
    const started = await strava.authStart?.(h.ctx, "https://example.com/callback", "host-state");
    if (!started) throw new Error("authStart missing");
    const auth = new URL(started.url);
    expect(auth.origin + auth.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(auth.searchParams.get("client_id")).toBe("client-id");
    expect(auth.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(auth.searchParams.get("response_type")).toBe("code");
    expect(auth.searchParams.get("approval_prompt")).toBe("force");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("state")).toBe("host-state");
    expect(auth.searchParams.get("scope")).toBe(stravaScopes);
    challenge = auth.searchParams.get("code_challenge") ?? "";
    expect(challenge).toHaveLength(43);
    expect(started.url).not.toContain("super-secret-value");
    const pending = h.ctx.sql.one<{ expires: number; state: string }>("SELECT expires, state FROM strava_oauth_pending WHERE id = 1");
    expect(pending?.state).toBe("host-state");
    expect(pending?.expires).toBe(now + 10 * 60 * 1000);

    await strava.authFinish?.(h.ctx, "https://example.com/callback", "auth-code");
    expect(h.token()).toMatchObject({ accessToken: "new-access", expiresAt: 1_700_000_100_000, refreshToken: "new-refresh", tokenType: "Bearer" });
    expect(h.ctx.sql.one("SELECT id FROM strava_oauth_pending WHERE id = 1")).toBeNull();
    await expect(strava.authFinish?.(h.ctx, "https://example.com/callback", "again")).rejects.toThrow("no pending authorization (run `strava-mcp auth url` first)");
  });

  it("expires the pending row and omits an empty verifier", async () => {
    const h = harness();
    await strava.authStart?.(h.ctx, "https://example.com/callback", "state-1");
    const row = h.ctx.sql.one<{ expires: number }>("SELECT expires FROM strava_oauth_pending WHERE id = 1");
    h.clock.set((row?.expires ?? 0) + 1);
    await expect(strava.authFinish?.(h.ctx, "https://example.com/callback", "code")).rejects.toThrow("pending authorization expired (run `strava-mcp auth url` again)");
    expect(h.ctx.sql.one("SELECT id FROM strava_oauth_pending WHERE id = 1")).toBeNull();

    const body = await new Promise<string>((resolve, reject) => {
      const ctx = harness({
        fetch: (_input, init) => {
          resolve(typeof init?.body === "string" ? init.body : "");
          return Promise.resolve(jsonResponse({ access_token: "a", expires_at: 10, refresh_token: "r" }));
        },
      }).ctx;
      exchangeCode(ctx, "c", "").then(() => undefined, reject);
    });
    expect(body).not.toContain("code_verifier");
    expect(body).not.toContain("redirect_uri");
  });

  it("refuses to start without client credentials", async () => {
    const h = harness({ env: { STRAVA_CLIENT_ID: "only-id" } });
    await expect(strava.authStart?.(h.ctx, "https://example.com/callback", "s")).rejects.toThrow(/STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET/);
  });
});

describe("token client", () => {
  it("refreshes an expired token once and reuses it", async () => {
    let refreshes = 0;
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/oauth/token")) {
          refreshes += 1;
          const form = new URLSearchParams(h.seen.at(-1)?.body ?? "");
          expect(form.get("grant_type")).toBe("refresh_token");
          expect(form.get("refresh_token")).toBe("refresh-secret-token");
          expect(form.get("client_secret")).toBe("super-secret-value");
          return Promise.resolve(jsonResponse({ access_token: "fresh-access", expires_at: Math.floor(now / 1000) + 6 * 3600, refresh_token: "fresh-refresh" }));
        }
        expect(h.token()?.accessToken).toBe("fresh-access");
        expect(new Headers(h.seen.at(-1)?.headers).get("authorization")).toBe("Bearer fresh-access");
        return Promise.resolve(jsonResponse({ ok: true }));
      },
      token: { accessToken: "access-secret-token", expiresAt: now - 3600_000, refreshToken: "refresh-secret-token" },
    });
    const client = clientFor(h.ctx);
    await client.get("/athlete");
    await client.get("/athlete");
    expect(refreshes).toBe(1);
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0]?.expiresAt).toBe((Math.floor(now / 1000) + 6 * 3600) * 1000);
  });

  it("treats a token inside the 5 minute skew as expired", async () => {
    let refreshes = 0;
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/oauth/token")) {
          refreshes += 1;
          return Promise.resolve(jsonResponse({ access_token: "fresh", expires_at: Math.floor(now / 1000) + 3600, refresh_token: "r" }));
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      },
      token: { accessToken: "old", expiresAt: now + 300_000, refreshToken: "r" },
    });
    await clientFor(h.ctx).get("/athlete");
    expect(refreshes).toBe(1);
    const later = harness({
      fetch: (input) => {
        expect(urlOf(input).pathname).not.toContain("oauth");
        return Promise.resolve(jsonResponse({ ok: true }));
      },
      token: { accessToken: "old", expiresAt: now + 360_000, refreshToken: "r" },
    });
    await clientFor(later.ctx).get("/athlete");
  });

  it("retries one 401 and does not loop", async () => {
    let apiCalls = 0;
    const h = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/oauth/token")) {
          return Promise.resolve(jsonResponse({ access_token: "after-401", expires_at: Math.floor(now / 1000) + 3600, refresh_token: "r2" }));
        }
        apiCalls += 1;
        if (apiCalls === 1) return Promise.resolve(jsonResponse({ message: "Authorization Error" }, 401));
        return Promise.resolve(jsonResponse({ ok: true }));
      },
      token: live(),
    });
    const ok = await clientFor(h.ctx).get("/athlete");
    expect(ok).toContain("ok");
    expect(apiCalls).toBe(2);

    let stubborn = 0;
    const again = harness({
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/oauth/token")) {
          return Promise.resolve(jsonResponse({ access_token: "still-bad", expires_at: Math.floor(now / 1000) + 3600, refresh_token: "r" }));
        }
        stubborn += 1;
        return Promise.resolve(jsonResponse({ message: "Authorization Error" }, 401));
      },
      token: live(),
    });
    await expect(clientFor(again.ctx).get("/athlete")).rejects.toThrow(/Strava API error \(401\)/);
    expect(stubborn).toBe(2);
  });

  it("replays a post body on the 401 retry", async () => {
    let posts = 0;
    const h = harness({
      fetch: (input, init) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/oauth/token")) {
          return Promise.resolve(jsonResponse({ access_token: "after", expires_at: Math.floor(now / 1000) + 3600, refresh_token: "r" }));
        }
        posts += 1;
        expect(init?.method).toBe("POST");
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toMatchObject({ name: "Morning Run" });
        if (posts === 1) return Promise.resolve(jsonResponse({ message: "Authorization Error" }, 401));
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer after");
        return Promise.resolve(jsonResponse({ id: 1 }, 201));
      },
      token: live(),
    });
    const result = await callTool(h.ctx, "activities_create", {
      elapsed_time: 10,
      name: "Morning Run",
      sport_type: "Run",
      start_date_local: "2024-01-13T06:00:00Z",
    });
    expect(result.isError).toBeUndefined();
    expect(posts).toBe(2);
  });

  it("coalesces concurrent refreshes", async () => {
    let refreshes = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      fetch: async (input) => {
        const url = urlOf(input);
        if (url.pathname.endsWith("/oauth/token")) {
          refreshes += 1;
          await gate;
          return jsonResponse({ access_token: "shared", expires_at: Math.floor(now / 1000) + 3600, refresh_token: "r" });
        }
        return jsonResponse({ ok: true });
      },
      token: { accessToken: "old", expiresAt: now - 1000, refreshToken: "r" },
    });
    const client = clientFor(h.ctx);
    const pending = Promise.all(Array.from({ length: 8 }, () => client.get("/athlete")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(refreshes).toBe(1);
    release();
    await pending;
    expect(refreshes).toBe(1);
    expect(h.puts).toHaveLength(1);
  });

  it("reports refresh, persist, decode, and missing-token failures", async () => {
    const expired = { accessToken: "old", expiresAt: now - 1000, refreshToken: "r" };
    const rejected = harness({
      fetch: () => Promise.resolve(jsonResponse({ message: "Bad Request" }, 400)),
      token: expired,
    });
    await expect(clientFor(rejected.ctx).get("/athlete")).rejects.toThrow(/token refresh: refresh failed \(400\)/);
    const junk = harness({
      fetch: () => Promise.resolve(jsonResponse("not json")),
      token: expired,
    });
    await expect(clientFor(junk.ctx).get("/athlete")).rejects.toThrow(/decode refresh response/);
    const disk = harness({
      failPut: true,
      fetch: () => Promise.resolve(jsonResponse({ access_token: "fresh", expires_at: 10, refresh_token: "r" })),
      token: expired,
    });
    await expect(clientFor(disk.ctx).get("/athlete")).rejects.toThrow(/persist refreshed tokens/);
    const down = harness({
      fetch: () => Promise.reject(new Error("down")),
      token: expired,
    });
    await expect(clientFor(down.ctx).get("/athlete")).rejects.toThrow(/refresh request/);
    const empty = harness();
    await expect(clientFor(empty.ctx).get("/athlete")).rejects.toThrow(/read tokens: no tokens/);
    const encoded = harness({ token: live() });
    await clientFor(encoded.ctx).get("/activities", { keys: "a,b", q: "a b" });
    expect(encoded.seen[0]?.url.search).toBe("?keys=a%2Cb&q=a+b");
  });

  it("parses rate-limit headers and never logs secrets", async () => {
    const h = harness({
      fetch: () => Promise.resolve(jsonResponse({}, 200, { "X-RateLimit-Limit": "10", "X-RateLimit-Usage": "9,1" })),
      token: live(),
    });
    await clientFor(h.ctx).get("/athlete");
    expect(clientFor(h.ctx).rateLimits()).toMatchObject({ limit15: 10, limitDaily: 0, usage15: 9, usageDaily: 1 });
    expect(clientFor(h.ctx).rateLimitWarning()).toBe("Note: 9/10 API calls used in this 15-min window.");
    const quiet = harness({ token: live() });
    await clientFor(quiet.ctx).get("/athlete");
    expect(clientFor(quiet.ctx).rateLimits()).toEqual({ limit15: 0, limitDaily: 0, usage15: 0, usageDaily: 0 });
    expect(clientFor(quiet.ctx).rateLimitWarning()).toBe("");
    const logged = JSON.stringify(h.sink.records);
    expect(logged).not.toContain("super-secret-value");
    expect(logged).not.toContain("access-secret-token");
    expect(logged).not.toContain("refresh-secret-token");
  });
});

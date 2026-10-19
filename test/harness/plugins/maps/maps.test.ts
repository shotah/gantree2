import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink, nodeSql, type NodeDatabase } from "@/harness/core";
import type { CallContext, PluginContext, ToolResult } from "@/harness/core/tools";
import { maps } from "@/harness/plugins/maps";
import { geocode, placeDetails, reverseGeocode, textSearch, directions, routeEta, searchPlaces, teachPlace, teachSearch, teachRoute, parseDepartureTime, MapsApiError, MissingKeyError } from "@/harness/plugins/maps/client";
import { allowedMapsHost, directionsUrl, httpGet, isGoogleTld, isShortMapsHost, kindDirections, kindSearch, kindUnknown, kindView, looksLikeMapsUrl, parseLatLng, parseMapsUrl, pathSegment, resolveLink } from "@/harness/plugins/maps/link";

const call: CallContext = { userId: "u", sessionId: "s" };

function ctx(env: Record<string, string>, fetchImpl: typeof fetch, now = Date.parse("2026-08-16T14:00:00Z")): PluginContext {
  return {
    env,
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    clock: fixedClock(now),
    log: makeLogger(memorySink(), () => now),
    fetch: fetchImpl,
    tokens: {
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
      async delete() {
        return undefined;
      },
      async list() {
        return [];
      },
    },
  };
}

function textOf(result: ToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("expected text content");
  }
  return first.text;
}

async function callTool(pluginCtx: PluginContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = maps.tools(pluginCtx).find((item) => item.name === name);
  if (!tool) {
    throw new Error(`missing tool ${name}`);
  }
  return tool.call(args, call);
}

function jsonBody(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const geocodeOk = {
  status: "OK",
  results: [{
    place_id: "ChIJ1",
    formatted_address: "400 Broad St, Seattle, WA 98109, USA",
    address_components: [{ long_name: "Space Needle", types: ["point_of_interest"] }],
    geometry: { location: { lat: 47.6205, lng: -122.3493 } },
  }],
};

const placesSearchOk = {
  status: "OK",
  results: [
    {
      place_id: "ChIJ-sushi",
      name: "Sushi Kappo",
      formatted_address: "123 Ballard Ave, Seattle, WA",
      rating: 4.6,
      user_ratings_total: 210,
      geometry: { location: { lat: 47.67, lng: -122.38 } },
      opening_hours: { open_now: true },
    },
    {
      place_id: "ChIJ-omakase",
      name: "Omakase Bar",
      vicinity: "Ballard",
      rating: 4.4,
      geometry: { location: { lat: 47.66, lng: -122.37 } },
    },
  ],
};

const placeDetailsOk = {
  status: "OK",
  result: {
    place_id: "ChIJ1",
    name: "Space Needle",
    formatted_address: "400 Broad St, Seattle, WA 98109, USA",
    rating: 4.7,
    user_ratings_total: 90000,
    url: "https://maps.google.com/?cid=1",
    website: "https://www.spaceneedle.com/",
    geometry: { location: { lat: 47.6205, lng: -122.3493 } },
    reviews: [{
      author_name: "Sam",
      rating: 5,
      text: "Great views.",
      relative_time_description: "2 months ago",
    }],
  },
};

const directionsOk = {
  status: "OK",
  routes: [{
    summary: "I-5 S",
    legs: [{
      start_address: "Seattle, WA, USA",
      end_address: "Portland, OR, USA",
      distance: { text: "174 mi", value: 280000 },
      duration: { text: "2 hours 45 mins", value: 9900 },
      duration_in_traffic: { text: "3 hours", value: 10800 },
    }],
  }],
};

function mapsApi(handler: (url: URL) => Response): typeof fetch {
  return (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(handler(url));
  };
}

describe("maps plugin", () => {
  it("publishes the four Go tool names, descriptions, and schemas", async () => {
    const pluginCtx = ctx({ GOOGLE_MAPS_API_KEY: "k" }, mapsApi(() => jsonBody({})));
    expect(maps.name).toBe("maps");
    expect(await maps.ready(pluginCtx)).toBeNull();
    expect(await maps.ready(ctx({}, mapsApi(() => jsonBody({}))))).toBe("no_key");
    const tools = maps.tools(pluginCtx);
    expect(tools.map((tool) => tool.name)).toEqual(["link_resolve", "place_resolve", "place_search", "route_eta"]);
    const link = tools[0];
    expect(link?.description.startsWith("Turn one or more Google Maps share")).toBe(true);
    expect(link?.inputSchema).toMatchObject({
      type: "object",
      required: [],
      properties: {
        url: { type: "string" },
        urls: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
      },
    });
    expect(tools[1]?.inputSchema).toMatchObject({
      required: [],
      properties: { places: { type: "array" }, query: { type: "string" }, queries: { type: "array" } },
    });
    expect(tools[2]?.inputSchema).toMatchObject({
      required: [],
      properties: { near: { type: "string" }, limit: { type: "number" }, query: { type: "string" } },
    });
    const routes = tools[3]?.inputSchema.properties;
    expect(routes).toMatchObject({ routes: { type: "array", minItems: 1, maxItems: 8 } });
    const routeItems = routes !== null && typeof routes === "object" && "routes" in routes ? routes.routes : null;
    expect(routeItems !== null && typeof routeItems === "object" && !("items" in routeItems)).toBe(true);
  });

  it("parses long maps URLs without a fetch", async () => {
    const fetchImpl = mapsApi(() => {
      throw new Error("no fetch");
    });
    const place = "https://www.google.com/maps/place/Space+Needle/@47.6205,-122.3493,17z";
    const result = await callTool(ctx({}, fetchImpl), "link_resolve", { urls: [place] });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(textOf(result)) as { kind: string; name: string; lat: number; lng: number; canonical: string }[];
    expect(body[0]).toMatchObject({ kind: "place", name: "Space Needle", lat: 47.6205, lng: -122.3493, canonical: place });

    expect(parseMapsUrl("https://www.google.com/maps/place/Space+Needle/@47.6205,-122.3513,17z/data=!3m1!4b1!8m2!3d47.6205099!4d-122.3493894")).toMatchObject({ lat: 47.6205099, lng: -122.3493894 });
    expect(parseMapsUrl("https://www.google.com/maps/dir/Seattle,+WA/Portland,+OR/@45.5,-122.0,8z")).toMatchObject({ kind: kindDirections, origin: "Seattle, WA", destination: "Portland, OR" });
    expect(parseMapsUrl("https://www.google.com/maps/dir/Seattle,+WA/Portland,+OR/@45.5,-122.0,8z").lat).toBeUndefined();
    expect(parseMapsUrl("https://www.google.com/maps/dir/?api=1&origin=Seattle&destination=Portland")).toMatchObject({ kind: kindDirections, origin: "Seattle", destination: "Portland" });
    expect(parseMapsUrl("https://www.google.com/maps/search/coffee+shops/@47.6,-122.3,14z")).toMatchObject({ kind: kindSearch, name: "coffee shops" });
    expect(parseMapsUrl("https://www.google.com/maps/@47.6205,-122.3493,17z")).toMatchObject({ kind: kindView, lat: 47.6205 });
    expect(parseMapsUrl("https://maps.google.com/maps?q=47.6205,-122.3493")).toMatchObject({ kind: kindView, lat: 47.6205 });
    expect(parseMapsUrl("https://maps.google.com/maps?saddr=Seattle&daddr=Portland")).toMatchObject({ kind: kindDirections, origin: "Seattle", destination: "Portland" });
    expect(parseMapsUrl("https://www.google.com/maps?q=Space+Needle")).toMatchObject({ kind: kindSearch, name: "Space Needle" });
    expect(parseMapsUrl("https://www.google.com/maps").kind).toBe(kindUnknown);
    expect(parseMapsUrl("://bad").kind).toBe(kindUnknown);
  });

  it("follows a short URL and keeps a final long URL when the hop errors", async () => {
    const canonical = "https://www.google.com/maps/place/Pike+Place/@47.6,-122.3,17z";
    const fetchImpl = mapsApi((url) => {
      if (url.hostname === "goo.gl") {
        return new Response(null, { status: 302, headers: { location: canonical } });
      }
      return new Response("no", { status: 403 });
    });
    const got = await resolveLink("https://goo.gl/maps/xxxx", { fetch: fetchImpl });
    expect(got.name).toBe("Pike Place");
    expect(got.canonical).toBe(canonical);
  });

  it("rejects a non-maps host inside the batch and a missing urls list as a tool error", async () => {
    const pluginCtx = ctx({}, mapsApi(() => jsonBody({})));
    const bad = await callTool(pluginCtx, "link_resolve", { urls: ["https://example.com/x"] });
    expect(bad.isError).toBeUndefined();
    expect(textOf(bad)).toContain("not a Google Maps host");
    const missing = await callTool(pluginCtx, "link_resolve", {});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("urls is required");
    expect(textOf(missing)).toContain("link_resolve");
    const singular = await callTool(pluginCtx, "link_resolve", { url: "https://www.google.com/maps" });
    expect(singular.isError).toBeUndefined();
    const singularBody = JSON.parse(textOf(singular)) as { url: string }[];
    expect(singularBody).toHaveLength(1);
    expect(singularBody[0]?.url).toBe("https://www.google.com/maps");
    await expect(resolveLink("  ", { fetch: mapsApi(() => jsonBody({})) })).rejects.toThrow(/url is required/);
    await expect(resolveLink("ftp://maps.app.goo.gl/x", { fetch: mapsApi(() => jsonBody({})) })).rejects.toThrow();
  });
});

describe("maps hosts", () => {
  it("allows Google Maps hosts and refuses everything else", () => {
    for (const host of ["maps.app.goo.gl", "goo.gl", "g.co", "google.com", "www.google.com", "maps.google.com", "www.google.com:443", "www.google.de", "www.google.co.uk", "maps.google.com.au", "GOOGLE.COM"]) {
      expect(allowedMapsHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "evil.com", "localhost", "127.0.0.1", "maps.app.goo.gl.evil.com", "goo.gl.evil.com", "www.google.evil.com", "notgoogle.com", ""]) {
      expect(allowedMapsHost(host), host).toBe(false);
    }
    expect(isShortMapsHost("maps.app.goo.gl")).toBe(true);
    expect(isShortMapsHost("www.google.com")).toBe(false);
    expect(isGoogleTld("com") && isGoogleTld("de") && isGoogleTld("co.uk") && isGoogleTld("com.au")).toBe(true);
    expect(looksLikeMapsUrl("https://maps.app.goo.gl/x")).toBe(true);
    expect(looksLikeMapsUrl("Space Needle") || looksLikeMapsUrl("https://example.com")).toBe(false);
    expect(parseLatLng("91,0")).toBeNull();
    expect(parseLatLng("0,200")).toBeNull();
    expect(parseLatLng("nope")).toBeNull();
    expect(parseLatLng("[last pin ±8m] 47.600000, -122.300000 at Wed Sep 9, 2026 9:44 PM PDT (just now)")).toEqual({ lat: 47.6, lng: -122.3 });
    expect(pathSegment("%zz")).toBe("%zz");
    const url = directionsUrl("Space Needle", "47.6097,-122.3425", "driving");
    expect(url.startsWith("https://www.google.com/maps/dir/?")).toBe(true);
    expect(url).toContain("api=1");
    expect(url).toContain("travelmode=driving");
    expect(url).toContain("origin=Space+Needle");
    expect(url).toContain("destination=47.6097%2C-122.3425");
  });

  it("caps redirects, body size, and non-maps hops", async () => {
    let hops = 0;
    const looping: typeof fetch = (input) => {
      hops += 1;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(null, { status: 302, headers: { location: `${url}/hop` } }));
    };
    await expect(httpGet("https://www.google.com/maps/start", { fetch: looping, allowHost: () => true })).rejects.toThrow(/stopped after 5 redirects/);
    expect(hops).toBeGreaterThanOrEqual(2);

    const huge: typeof fetch = () => Promise.resolve(new Response("x".repeat(64)));
    await expect(httpGet("https://www.google.com/maps/x", { fetch: huge, allowHost: () => true, maxBytes: 8 })).rejects.toThrow(/larger than/);
    await expect(httpGet("https://example.com/x", { fetch: huge })).rejects.toThrow(/non-Maps host/);
    const foreign: typeof fetch = () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://example.com/x" } }));
    await expect(httpGet("https://www.google.com/maps/x", { fetch: foreign })).rejects.toThrow(/non-Maps host/);
    const ftp: typeof fetch = () => Promise.resolve(new Response(null, { status: 302, headers: { location: "ftp://example.com/x" } }));
    await expect(httpGet("https://www.google.com/maps/x", { fetch: ftp, allowHost: () => true })).rejects.toThrow();
    const aborted = AbortSignal.abort();
    await expect(httpGet("https://www.google.com/maps/x", { fetch: huge, allowHost: () => true, signal: aborted })).rejects.toThrow();
  });
});

describe("maps platform", () => {
  it("geocodes, reverse-geocodes, and teaches API failures", async () => {
    const seen: string[] = [];
    const fetchImpl = mapsApi((url) => {
      seen.push(`${url.pathname}?${url.searchParams.get("key") ?? ""}`);
      if (url.pathname.endsWith("/geocode/json") && url.searchParams.get("latlng")) {
        expect(url.searchParams.get("latlng")).toBe("47.62,-122.35");
        return jsonBody({
          status: "OK",
          results: [{
            place_id: "ChIJ2",
            formatted_address: "Seattle, WA, USA",
            geometry: { location: { lat: 47.62, lng: -122.35 } },
          }],
        });
      }
      if (url.searchParams.get("address") === "zzz") {
        return jsonBody({ status: "ZERO_RESULTS" });
      }
      return jsonBody(geocodeOk);
    });
    const client = { fetch: fetchImpl, apiKey: "test-key", now: () => 0 };
    const got = await geocode(client, "Space Needle");
    expect(got.placeId).toBe("ChIJ1");
    expect(got.name).toBe("Space Needle");
    expect(got.lat).toBe(47.6205);
    expect(seen[0]).toContain("/maps/api/geocode/json?test-key");
    const rev = await reverseGeocode(client, 47.62, -122.35);
    expect(rev.placeId).toBe("ChIJ2");
    expect(rev.name).toBe("Seattle");
    await expect(geocode(client, "zzz")).rejects.toBeInstanceOf(MapsApiError);
    await expect(geocode({ ...client, apiKey: " " }, "x")).rejects.toBeInstanceOf(MissingKeyError);
    const denied = mapsApi(() => jsonBody({ status: "REQUEST_DENIED", error_message: "denied" }, 403));
    await expect(geocode({ fetch: denied, apiKey: "k", now: () => 0 }, "x")).rejects.toMatchObject({ status: "REQUEST_DENIED" });
    const bad = mapsApi(() => new Response("not-json"));
    await expect(geocode({ fetch: bad, apiKey: "k", now: () => 0 }, "x")).rejects.toThrow(/geocode/);
    expect(teachPlace(new MapsApiError(200, "ZERO_RESULTS", ""), "zzz")).toContain("\"zzz\"");
    expect(teachPlace(new MapsApiError(200, "OVER_QUERY_LIMIT", ""), "x")).toContain("quota");
    expect(teachPlace(new MapsApiError(403, "", ""), "x")).toContain("GOOGLE_MAPS_API_KEY");
    expect(teachPlace(new Error("boom"), "x")).toBe("boom");
  });

  it("resolves and searches places, clipping reviews", async () => {
    const fetchImpl = mapsApi((url) => {
      if (url.pathname.includes("/place/textsearch/")) {
        return jsonBody(placesSearchOk);
      }
      if (url.pathname.includes("/place/details/")) {
        return jsonBody(placeDetailsOk);
      }
      if (url.pathname.includes("/geocode/")) {
        return jsonBody(geocodeOk);
      }
      return jsonBody({}, 404);
    });
    const pluginCtx = ctx({ GOOGLE_MAPS_API_KEY: "k" }, fetchImpl);
    const resolved = await callTool(pluginCtx, "place_resolve", { queries: ["Space Needle"] });
    const place = JSON.parse(textOf(resolved)) as { place_id: string; rating: number; reviews: { author: string; text: string }[] }[];
    expect(place[0]?.place_id).toBe("ChIJ1");
    expect(place[0]?.rating).toBe(4.7);
    expect(place[0]?.reviews[0]?.author).toBe("Sam");

    const long = "x".repeat(420);
    const details = await placeDetails({ fetch: mapsApi(() => jsonBody({
      status: "OK",
      result: {
        place_id: "p",
        name: "N",
        reviews: [
          { author_name: "a", rating: 5, text: long, relative_time_description: "1w" },
          { author_name: "b", rating: 4, text: "ok", relative_time_description: "2w" },
          { author_name: "c", rating: 3, text: "meh", relative_time_description: "3w" },
          { author_name: "d", rating: 2, text: "no", relative_time_description: "4w" },
        ],
      },
    })), apiKey: "k", now: () => 0 }, "p");
    expect(details.reviews).toHaveLength(3);
    expect(details.reviews?.[0]?.text?.endsWith("…")).toBe(true);
    expect((details.reviews?.[0]?.text ?? "").length).toBeGreaterThanOrEqual(400);

    const searched = await callTool(pluginCtx, "place_search", { queries: ["sushi"], limit: 1 });
    const hits = JSON.parse(textOf(searched)) as { places: { name: string; url: string; open_now?: boolean }[] }[];
    expect(hits[0]?.places).toHaveLength(1);
    expect(hits[0]?.places[0]?.name).toBe("Sushi Kappo");
    expect(hits[0]?.places[0]?.url).toContain("query_place_id=ChIJ-sushi");
    expect(hits[0]?.places[0]?.open_now).toBe(true);

    let loc = "";
    const nearFetch = mapsApi((url) => {
      if (url.pathname.includes("/place/textsearch/")) {
        loc = url.searchParams.get("location") ?? "";
        expect(url.searchParams.get("query")).toBe("sushi");
        expect(url.searchParams.get("radius")).toBe("5000");
        return jsonBody(placesSearchOk);
      }
      return jsonBody({}, 404);
    });
    const near = await searchPlaces({ fetch: nearFetch, apiKey: "k", now: () => 0 }, { fetch: nearFetch }, "sushi", "47.67,-122.38", 5);
    expect(loc).toBe("47.67,-122.38");
    expect(near.near).toBe("47.67,-122.38");

    const zero = await callTool(ctx({ GOOGLE_MAPS_API_KEY: "k" }, mapsApi(() => jsonBody({ status: "ZERO_RESULTS" }))), "place_resolve", { queries: ["zzz"] });
    expect(zero.isError).toBeUndefined();
    expect(textOf(zero)).toContain("no place found");
    const noKey = await callTool(ctx({}, mapsApi(() => jsonBody({}))), "place_search", { queries: ["sushi"] });
    expect(noKey.isError).toBe(true);
    expect(textOf(noKey)).toContain("GOOGLE_MAPS_API_KEY");
    const missing = await callTool(pluginCtx, "place_search", {});
    expect(textOf(missing)).toContain("queries is required");
    expect(teachSearch(new MapsApiError(200, "REQUEST_DENIED", ""), "x")).toContain("Places API");
    await expect(searchPlaces({ fetch: fetchImpl, apiKey: "k", now: () => 0 }, { fetch: fetchImpl }, "  ", "", 5)).rejects.toThrow(/query is required/);
    await expect(textSearch({ fetch: mapsApi(() => new Response("not-json")), apiKey: "k", now: () => 0 }, "x", "", 0)).rejects.toThrow(/places search/);
    await expect(placeDetails({ fetch: mapsApi(() => jsonBody({ status: "OK", result: {} })), apiKey: "k", now: () => 0 }, "x")).rejects.toThrow();
  });

  it("returns traffic-aware ETAs and teaches route failures", async () => {
    const now = Date.parse("2026-08-16T14:00:00Z");
    let mode = "";
    let depart = "";
    const fetchImpl = mapsApi((url) => {
      mode = url.searchParams.get("mode") ?? "";
      depart = url.searchParams.get("departure_time") ?? "";
      if (url.searchParams.get("origin") === "nowhere") {
        return jsonBody({ status: "NOT_FOUND" });
      }
      if (mode === "walking") {
        return jsonBody({
          status: "OK",
          routes: [{
            summary: "trail",
            legs: [{
              start_address: "A",
              end_address: "B",
              distance: { text: "1 mi", value: 1600 },
              duration: { text: "20 mins", value: 1200 },
            }],
          }],
        });
      }
      return jsonBody(directionsOk);
    });
    const pluginCtx = ctx({ GOOGLE_MAPS_API_KEY: "k" }, fetchImpl, now);
    const ok = await callTool(pluginCtx, "route_eta", {
      routes: [{ origin: "Seattle", destination: "Portland", departure_time: "now" }],
    });
    const parsed = JSON.parse(textOf(ok)) as { duration_seconds: number; duration_in_traffic_seconds: number; mode: string; arrival_time: string; url: string }[];
    expect(parsed[0]?.duration_in_traffic_seconds).toBe(10800);
    expect(parsed[0]?.mode).toBe("driving");
    expect(parsed[0]?.url).toContain("origin=Seattle");
    expect(parsed[0]?.url).toContain("destination=Portland");
    expect(parsed[0]?.arrival_time).toBe("2026-08-16T17:00:00Z");
    expect(depart).toBe("now");

    const walk = await callTool(pluginCtx, "route_eta", {
      routes: [{ origin: "Seattle", destination: "Portland", mode: "walking", departure_time: "now" }],
    });
    const walked = JSON.parse(textOf(walk)) as { mode: string; duration_seconds: number; url: string }[];
    expect(walked[0]?.mode).toBe("walking");
    expect(walked[0]?.duration_seconds).toBe(1200);
    expect(mode).toBe("walking");
    expect(depart).toBe("");
    expect(walked[0]?.url).toContain("travelmode=walking");

    const share = await routeEta(
      { fetch: fetchImpl, apiKey: "k", now: () => now },
      { fetch: fetchImpl },
      "https://www.google.com/maps/place/Seattle/@47.6,-122.3,10z",
      "https://www.google.com/maps/dir/Seattle/Portland,+OR",
      "",
      "",
    );
    expect(share.summary).toBe("I-5 S");

    const missing = await callTool(pluginCtx, "route_eta", {});
    expect(textOf(missing)).toContain("routes is required");
    const singular = await callTool(pluginCtx, "route_eta", { origin: "Seattle", destination: "Portland" });
    expect(singular.isError).toBeUndefined();
    const singularBody = JSON.parse(textOf(singular)) as { origin: string; destination: string; url: string }[];
    expect(singularBody).toHaveLength(1);
    expect(singularBody[0]?.url).toContain("origin=Seattle");
    expect(singularBody[0]?.url).toContain("destination=Portland");
    const badMode = await callTool(pluginCtx, "route_eta", { routes: [{ origin: "a", destination: "b", mode: "hoverboard" }] });
    expect(textOf(badMode)).toContain("mode must be");
    const notFound = await callTool(pluginCtx, "route_eta", { routes: [{ origin: "nowhere", destination: "Portland" }] });
    expect(textOf(notFound)).toContain("no route found");
    const noKey = await callTool(ctx({}, fetchImpl), "route_eta", { routes: [{ origin: "a", destination: "b" }] });
    expect(noKey.isError).toBe(true);
    expect(textOf(noKey)).toContain("GOOGLE_MAPS_API_KEY");
    expect(teachRoute(new MapsApiError(200, "OVER_QUERY_LIMIT", ""))).toContain("quota");
    expect(parseDepartureTime("", now).param).toBe("now");
    expect(parseDepartureTime("1700000000", now)).toEqual({ param: "1700000000", at: 1700000000 * 1000 });
    expect(parseDepartureTime("2026-01-02T03:04:05Z", now).param).toBe(String(Date.parse("2026-01-02T03:04:05Z") / 1000));
    expect(() => parseDepartureTime("yesterday", now)).toThrow(/departure_time/);
    await expect(directions({ fetch: mapsApi(() => new Response("{")), apiKey: "k", now: () => now }, "a", "b", "now", "driving")).rejects.toThrow(/directions/);
    await expect(directions({ fetch: mapsApi(() => jsonBody({ status: "OK", routes: [] })), apiKey: "k", now: () => now }, "a", "b", "now", "driving")).rejects.toThrow();
  });

  it("place_resolve accepts places and a single query", async () => {
    const fetchImpl = mapsApi((url) => {
      if (url.pathname.includes("/place/details/")) return jsonBody(placeDetailsOk);
      if (url.pathname.includes("/geocode/")) return jsonBody(geocodeOk);
      return jsonBody({}, 404);
    });
    const pluginCtx = ctx({ GOOGLE_MAPS_API_KEY: "k" }, fetchImpl);
    const many = JSON.parse(textOf(await callTool(pluginCtx, "place_resolve", { places: ["Space Needle", "Pike Place"] }))) as { query: string }[];
    expect(many.map((row) => row.query)).toEqual(["Space Needle", "Pike Place"]);
    const one = JSON.parse(textOf(await callTool(pluginCtx, "place_resolve", { query: "Space Needle" }))) as { query: string }[];
    expect(one).toHaveLength(1);
    expect(one[0]?.query).toBe("Space Needle");
    const searched = JSON.parse(textOf(await callTool(pluginCtx, "place_search", { query: "sushi" }))) as { query: string }[];
    expect(searched).toHaveLength(1);
    expect(searched[0]?.query).toBe("sushi");
  });
});

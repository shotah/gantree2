/**
 * Maps plugin. Tool names, descriptions, and input schemas match the Go
 * server's tools/list (mcp-go object schema, `required: []` when nothing is
 * required).
 */
import { errorResult, jsonResult, type CallContext, type JsonSchema, type Plugin, type PluginContext, type Tool, type ToolResult } from "@/brain/core/tools";
import {
  MissingKeyError,
  resolvePlace,
  routeEta,
  searchPlaces,
  teachPlace,
  teachRoute,
  teachSearch,
  type MapsClient,
  type PlaceFields,
  type PlaceHit,
  type PlaceReview,
  type RouteFields,
  type SearchFields,
} from "./client.ts";
import {
  maxBatch,
  nextLinkResolve,
  nextPlaceResolve,
  nextPlaceSearch,
  nextRouteEta,
  resolveLink,
  type FetchGet,
  type LinkFields,
} from "./link.ts";

export { keys } from "./keys";

const linkDescription = "Turn one or more Google Maps share or short URLs (maps.app.goo.gl, goo.gl/maps, g.co/maps) into canonical maps URLs plus place name, coordinates, or directions endpoints. Pass every link in urls (max 8). No API key. Already-long google.com/maps URLs are parsed without a fetch. Not a geocoder — use place_resolve for an address. A single url is also accepted. Returns a list.";
const placeDescription = "Look up one or more places by name, address, or Maps share URL. Pass every lookup in queries or places (max 8). Returns place_id, coordinates, rating, a few reviews, and a Maps URL for each. Use for “what is this pin” and “tell me about X”. For “sushi near Ballard” use place_search. Needs GOOGLE_MAPS_API_KEY. A single query is also accepted. Returns a list.";
const searchDescription = "Find a few places for each query, optionally near a location. Pass every search in queries (max 8). Use for “sushi restaurants near Ballard”, “coffee by the gym”, and “recommend a few spots”. Returns name, rating, address, and a Maps URL for each. Not a city-wide dump — default 5, max 8 hits per query. Needs GOOGLE_MAPS_API_KEY and Places API. For known pins use place_resolve. A single query is also accepted. Returns a list.";
const routeDescription = "Get duration, distance, and a tap-to-open Google Maps directions URL for each route. Pass every trip in routes (max 8). Use for “when do I leave?”, “how far by bike”, and “walking directions”. Origin and destination can be names, coordinates, or Maps share URLs. Optional mode (driving, walking, bicycling, transit) and departure_time (RFC3339, unix seconds, or now) on each route. Needs GOOGLE_MAPS_API_KEY. Official Directions API only — not turn-by-turn steps. A single origin and destination is also accepted. Returns a list.";

function stringProp(description: string): JsonSchema {
  return { type: "string", description };
}

function numberProp(description: string): JsonSchema {
  return { type: "number", description };
}

function stringArray(description: string): JsonSchema {
  return {
    type: "array",
    description,
    items: { type: "string" },
    minItems: 1,
    maxItems: maxBatch,
  };
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: "object", properties, required };
}

const urlsSchema = objectSchema({
  url: stringProp("One Maps share URL, short URL, or already-long google.com/maps URL."),
  urls: stringArray("Maps share URLs, short URLs, or already-long google.com/maps URLs. 1–8."),
}, []);

const queriesSchema = objectSchema({
  places: stringArray("Place names, addresses, or Maps share / long URLs. 1–8. Same as queries."),
  query: stringProp("One place name, address, or Maps share / long URL."),
  queries: stringArray("Place names, addresses, or Maps share / long URLs. 1–8."),
}, []);

const searchSchema = objectSchema({
  limit: numberProp("How many places to return (default 5, max 8)."),
  near: stringProp("Bias results to a place name, lat,lng, or Maps share URL."),
  query: stringProp("One search, e.g. sushi restaurants."),
  queries: stringArray("What to find, e.g. sushi restaurants, coffee, climbing gym. 1–8 queries."),
}, []);

const routesSchema = objectSchema({
  departure_time: stringProp("RFC3339, unix seconds, or now. Used with a single origin and destination."),
  destination: stringProp("Single-route destination. routes is also accepted."),
  mode: stringProp("driving, walking, bicycling, or transit. Used with a single origin and destination."),
  origin: stringProp("Single-route origin. routes is also accepted."),
  routes: {
    type: "array",
    description: "1–8 trips. Each object has origin, destination, and optional mode and departure_time.",
    minItems: 1,
    maxItems: maxBatch,
  },
}, []);

const FETCH_CAP = 4;

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

function fetchOpts(ctx: PluginContext, call: CallContext): FetchGet {
  return { fetch: ctx.fetch, signal: call.signal };
}

function clientOf(ctx: PluginContext, call: CallContext): MapsClient {
  return {
    fetch: ctx.fetch,
    apiKey: ctx.env.GOOGLE_MAPS_API_KEY ?? "",
    signal: call.signal,
    now: () => ctx.clock.now(),
  };
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function collectStrings(args: Record<string, unknown>, keys: readonly string[], label: string, next: string): string[] | string {
  const strings: string[] = [];
  let saw = false;
  for (const key of keys) {
    if (!Object.hasOwn(args, key)) continue;
    saw = true;
    const value = args[key];
    if (typeof value === "string") {
      strings.push(value);
      continue;
    }
    const list = asArray(value);
    if (!list) return `${key} must be a string or a list of strings. ${next}`;
    for (const item of list) {
      if (typeof item !== "string") return `${key} must be a string or a list of strings. ${next}`;
      strings.push(item);
    }
  }
  if (!saw || strings.length === 0) return `${label} is required. ${next}`;
  if (strings.length > maxBatch) return `${label} accepts at most ${maxBatch} items. ${next}`;
  return strings;
}

function requireObjects(args: Record<string, unknown>, key: string, next: string): Record<string, unknown>[] | string {
  if (!Object.hasOwn(args, key)) {
    return `${key} is required. ${next}`;
  }
  const value = asArray(args[key]);
  if (!value) {
    return `${key} must be a list of objects. ${next}`;
  }
  if (value.length === 0) {
    return `${key} is required. ${next}`;
  }
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = asRecord(value[i]);
    if (!item) {
      return `${key} item ${i} must be an object. ${next}`;
    }
    out.push(item);
  }
  if (out.length > maxBatch) {
    return `${key} accepts at most ${maxBatch} items. ${next}`;
  }
  return out;
}

function argString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

function argInt(args: Record<string, unknown>, key: string, fallback: number): number {
  if (!Object.hasOwn(args, key)) {
    return fallback;
  }
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return fallback;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function linkJson(link: LinkFields, error?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    url: link.url,
    canonical: link.canonical,
    kind: link.kind,
  };
  if (link.name) {
    out.name = link.name;
  }
  if (link.lat !== undefined) {
    out.lat = link.lat;
  }
  if (link.lng !== undefined) {
    out.lng = link.lng;
  }
  if (link.origin) {
    out.origin = link.origin;
  }
  if (link.destination) {
    out.destination = link.destination;
  }
  if (error) {
    out.error = error;
  }
  return out;
}

function reviewJson(review: PlaceReview): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (review.author) {
    out.author = review.author;
  }
  if (review.rating) {
    out.rating = review.rating;
  }
  if (review.text) {
    out.text = review.text;
  }
  if (review.when) {
    out.when = review.when;
  }
  return out;
}

function placeJson(place: PlaceFields, error?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { query: place.query };
  if (place.placeId) {
    out.place_id = place.placeId;
  }
  if (place.name) {
    out.name = place.name;
  }
  if (place.address) {
    out.address = place.address;
  }
  out.lat = place.lat;
  out.lng = place.lng;
  if (place.rating) {
    out.rating = place.rating;
  }
  if (place.ratings) {
    out.ratings = place.ratings;
  }
  if (place.openNow !== undefined) {
    out.open_now = place.openNow;
  }
  if (place.url) {
    out.url = place.url;
  }
  if (place.website) {
    out.website = place.website;
  }
  if (place.reviews && place.reviews.length > 0) {
    out.reviews = place.reviews.map(reviewJson);
  }
  if (error) {
    out.error = error;
  }
  return out;
}

function hitJson(hit: PlaceHit): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (hit.placeId) {
    out.place_id = hit.placeId;
  }
  if (hit.name) {
    out.name = hit.name;
  }
  if (hit.address) {
    out.address = hit.address;
  }
  out.lat = hit.lat;
  out.lng = hit.lng;
  if (hit.rating) {
    out.rating = hit.rating;
  }
  if (hit.ratings) {
    out.ratings = hit.ratings;
  }
  if (hit.priceLevel) {
    out.price_level = hit.priceLevel;
  }
  if (hit.openNow !== undefined) {
    out.open_now = hit.openNow;
  }
  if (hit.url) {
    out.url = hit.url;
  }
  return out;
}

function searchJson(result: SearchFields, error?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { query: result.query };
  if (result.near) {
    out.near = result.near;
  }
  out.places = result.places.map(hitJson);
  if (error) {
    out.error = error;
  }
  return out;
}

function routeJson(route: RouteFields, error?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    origin: route.origin,
    destination: route.destination,
    duration_seconds: route.durationSeconds,
  };
  if (route.mode) {
    out.mode = route.mode;
  }
  if (route.departureTime) {
    out.departure_time = route.departureTime;
  }
  if (route.arrivalTime) {
    out.arrival_time = route.arrivalTime;
  }
  if (route.durationText) {
    out.duration_text = route.durationText;
  }
  if (route.durationInTrafficSeconds) {
    out.duration_in_traffic_seconds = route.durationInTrafficSeconds;
  }
  if (route.durationInTrafficText) {
    out.duration_in_traffic_text = route.durationInTrafficText;
  }
  if (route.distanceMeters) {
    out.distance_meters = route.distanceMeters;
  }
  if (route.distanceText) {
    out.distance_text = route.distanceText;
  }
  if (route.summary) {
    out.summary = route.summary;
  }
  if (route.url) {
    out.url = route.url;
  }
  if (error) {
    out.error = error;
  }
  return out;
}

function linkTool(ctx: PluginContext): Tool {
  return {
    name: "link_resolve",
    description: linkDescription,
    inputSchema: urlsSchema,
    async call(args, call): Promise<ToolResult> {
      const urls = collectStrings(args, ["url", "urls"], "urls", nextLinkResolve);
      if (typeof urls === "string") {
        return errorResult(urls);
      }
      const results = await mapPool(urls, async (raw) => {
        try {
          return linkJson(await resolveLink(raw, fetchOpts(ctx, call)));
        } catch (err) {
          return linkJson({ url: raw, canonical: "", kind: "" }, message(err));
        }
      });
      return jsonResult(results);
    },
  };
}

function placeTool(ctx: PluginContext): Tool {
  return {
    name: "place_resolve",
    description: placeDescription,
    inputSchema: queriesSchema,
    async call(args, call): Promise<ToolResult> {
      const queries = collectStrings(args, ["query", "queries", "places"], "queries", nextPlaceResolve);
      if (typeof queries === "string") {
        return errorResult(queries);
      }
      let client: MapsClient;
      try {
        client = clientOf(ctx, call);
        if (!client.apiKey.trim()) {
          throw new MissingKeyError();
        }
      } catch (err) {
        return errorResult(message(err));
      }
      const results = await mapPool(queries, async (query) => {
        try {
          return placeJson(await resolvePlace(client, fetchOpts(ctx, call), query));
        } catch (err) {
          return placeJson({ query, lat: 0, lng: 0 }, teachPlace(err, query));
        }
      });
      return jsonResult(results);
    },
  };
}

function searchTool(ctx: PluginContext): Tool {
  return {
    name: "place_search",
    description: searchDescription,
    inputSchema: searchSchema,
    async call(args, call): Promise<ToolResult> {
      const queries = collectStrings(args, ["query", "queries"], "queries", nextPlaceSearch);
      if (typeof queries === "string") {
        return errorResult(queries);
      }
      const near = argString(args, "near");
      const limit = argInt(args, "limit", 5);
      let client: MapsClient;
      try {
        client = clientOf(ctx, call);
        if (!client.apiKey.trim()) {
          throw new MissingKeyError();
        }
      } catch (err) {
        return errorResult(message(err));
      }
      const results = await mapPool(queries, async (query) => {
        try {
          return searchJson(await searchPlaces(client, fetchOpts(ctx, call), query, near, limit));
        } catch (err) {
          return searchJson({ query, near: near || undefined, places: [] }, teachSearch(err, query));
        }
      });
      return jsonResult(results);
    },
  };
}

function routeTrips(args: Record<string, unknown>): Record<string, unknown>[] | string {
  const trips: Record<string, unknown>[] = [];
  if (Object.hasOwn(args, "routes")) {
    const parsed = requireObjects(args, "routes", nextRouteEta);
    if (typeof parsed === "string") return parsed;
    trips.push(...parsed);
  }
  if (Object.hasOwn(args, "origin") || Object.hasOwn(args, "destination") || Object.hasOwn(args, "mode") || Object.hasOwn(args, "departure_time")) {
    trips.push({
      departure_time: argString(args, "departure_time"),
      destination: argString(args, "destination"),
      mode: argString(args, "mode"),
      origin: argString(args, "origin"),
    });
  }
  if (trips.length === 0) return `routes is required. ${nextRouteEta}`;
  if (trips.length > maxBatch) return `routes accepts at most ${maxBatch} items. ${nextRouteEta}`;
  return trips;
}

function routeTool(ctx: PluginContext): Tool {
  return {
    name: "route_eta",
    description: routeDescription,
    inputSchema: routesSchema,
    async call(args, call): Promise<ToolResult> {
      const trips = routeTrips(args);
      if (typeof trips === "string") {
        return errorResult(trips);
      }
      let client: MapsClient;
      try {
        client = clientOf(ctx, call);
        if (!client.apiKey.trim()) {
          throw new MissingKeyError();
        }
      } catch (err) {
        return errorResult(message(err));
      }
      const results = await mapPool(trips, async (trip) => {
        const origin = argString(trip, "origin");
        const destination = argString(trip, "destination");
        try {
          return routeJson(await routeEta(client, fetchOpts(ctx, call), origin, destination, argString(trip, "departure_time"), argString(trip, "mode")));
        } catch (err) {
          return routeJson({ origin, destination, durationSeconds: 0 }, teachRoute(err));
        }
      });
      return jsonResult(results);
    },
  };
}

export const maps: Plugin = {
  name: "maps",
  ready(ctx) {
    return Promise.resolve((ctx.env.GOOGLE_MAPS_API_KEY ?? "").trim() ? null : "no_key");
  },
  tools(ctx) {
    return [linkTool(ctx), placeTool(ctx), searchTool(ctx), routeTool(ctx)];
  },
};

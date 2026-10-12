/**
 * Official Maps Platform HTTP APIs: Geocoding, Places, Directions.
 * The key is a query parameter and is never logged.
 */
import { encodeQuery } from "./encode.ts";
import {
  directionsUrl,
  firstNonEmpty,
  formatLatLng,
  looksLikeMapsUrl,
  mapsUserAgent,
  maxBytes,
  nextLinkResolve,
  nextPlaceResolve,
  nextPlaceSearch,
  nextRouteEta,
  parseLatLng,
  placeMapsUrl,
  resolveLink,
  type FetchGet,
  type LinkFields,
} from "./link.ts";

export const mapsBase = "https://maps.googleapis.com";
export const missingKeyMessage = `GOOGLE_MAPS_API_KEY is not set. Next: set GOOGLE_MAPS_API_KEY on this process (Maps Platform key), then place_resolve(queries=["Space Needle"]) or place_search(queries=["sushi near Ballard"])`;

export const modeDriving = "driving";
export const modeWalking = "walking";
export const modeBicycling = "bicycling";
export const modeTransit = "transit";

const maxReviews = 3;
const maxReviewChars = 400;
const defaultSearchLimit = 5;
const maxSearchLimit = 8;
const defaultSearchRadiusM = 5000;
const placeDetailsFields = "name,place_id,formatted_address,geometry,rating,user_ratings_total,url,reviews,website,price_level,opening_hours";

export class MissingKeyError extends Error {
  constructor() {
    super(missingKeyMessage);
    this.name = "MissingKeyError";
  }
}

export class MapsApiError extends Error {
  readonly httpStatus: number;
  readonly status: string;

  constructor(httpStatus: number, status: string, detail: string) {
    const message = detail.trim() || status.trim() || `HTTP ${httpStatus}`;
    super(`Maps API: ${message}`);
    this.name = "MapsApiError";
    this.httpStatus = httpStatus;
    this.status = status;
  }
}

export type PlaceReview = {
  author?: string;
  rating?: number;
  text?: string;
  when?: string;
};

export type PlaceFields = {
  query: string;
  placeId?: string;
  name?: string;
  address?: string;
  lat: number;
  lng: number;
  rating?: number;
  ratings?: number;
  openNow?: boolean;
  url?: string;
  website?: string;
  reviews?: PlaceReview[];
};

export type PlaceHit = {
  placeId?: string;
  name?: string;
  address?: string;
  lat: number;
  lng: number;
  rating?: number;
  ratings?: number;
  priceLevel?: number;
  openNow?: boolean;
  url?: string;
};

export type SearchFields = {
  query: string;
  near?: string;
  places: PlaceHit[];
};

export type RouteFields = {
  origin: string;
  destination: string;
  mode?: string;
  departureTime?: string;
  arrivalTime?: string;
  durationSeconds: number;
  durationText?: string;
  durationInTrafficSeconds?: number;
  durationInTrafficText?: string;
  distanceMeters?: number;
  distanceText?: string;
  summary?: string;
  url?: string;
};

export type MapsClient = {
  fetch: typeof fetch;
  apiKey: string;
  signal?: AbortSignal;
  now: () => number;
  baseUrl?: string;
};

export function requireKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) {
    throw new MissingKeyError();
  }
  return key;
}

export async function geocode(client: MapsClient, address: string): Promise<PlaceFields> {
  return geocodeQuery(client, { address }, address);
}

export async function reverseGeocode(client: MapsClient, lat: number, lng: number): Promise<PlaceFields> {
  const latlng = formatLatLng(lat, lng);
  return geocodeQuery(client, { latlng }, latlng);
}

async function geocodeQuery(client: MapsClient, query: Record<string, string>, label: string): Promise<PlaceFields> {
  const body = await apiGet(client, "/maps/api/geocode/json", query, "geocode");
  const results = arrayField(body, "results");
  const first = results[0];
  if (stringField(body, "status") !== "OK" || !isRecord(first)) {
    throw mapsStatus(200, stringField(body, "status"), stringField(body, "error_message"));
  }
  const geometry = recordField(first, "geometry");
  const location = geometry ? recordField(geometry, "location") : null;
  const formatted = stringField(first, "formatted_address");
  return {
    query: label,
    placeId: stringField(first, "place_id") || undefined,
    name: placeName(arrayField(first, "address_components"), formatted) || undefined,
    address: formatted || undefined,
    lat: numberField(location, "lat"),
    lng: numberField(location, "lng"),
  };
}

export async function textSearch(client: MapsClient, query: string, location: string, radiusM: number): Promise<PlaceHit[]> {
  const params: Record<string, string> = { query };
  if (location) {
    params.location = location;
    params.radius = String(radiusM < 1 ? defaultSearchRadiusM : radiusM);
  }
  const body = await apiGet(client, "/maps/api/place/textsearch/json", params, "places search");
  const results = arrayField(body, "results");
  if (stringField(body, "status") !== "OK" || results.length === 0) {
    throw mapsStatus(200, stringField(body, "status"), stringField(body, "error_message"));
  }
  return results.filter(isRecord).map(placeHitFromJson);
}

export async function placeDetails(client: MapsClient, placeId: string): Promise<PlaceFields> {
  const body = await apiGet(client, "/maps/api/place/details/json", { place_id: placeId, fields: placeDetailsFields }, "place details");
  const result = recordField(body, "result");
  if (stringField(body, "status") !== "OK" || !result || (!stringField(result, "place_id").trim() && !stringField(result, "name").trim())) {
    throw mapsStatus(200, stringField(body, "status"), stringField(body, "error_message"));
  }
  return placeResultFromJson(result);
}

export async function directions(client: MapsClient, origin: string, destination: string, departureParam: string, mode: string): Promise<RouteFields> {
  const travel = mode || modeDriving;
  const params: Record<string, string> = { origin, destination, mode: travel };
  if (departureParam && (travel === modeDriving || travel === modeTransit)) {
    params.departure_time = departureParam;
  }
  const body = await apiGet(client, "/maps/api/directions/json", params, "directions");
  const routes = arrayField(body, "routes");
  const route = routes[0];
  const legs = isRecord(route) ? arrayField(route, "legs") : [];
  const leg = legs[0];
  if (stringField(body, "status") !== "OK" || !isRecord(route) || !isRecord(leg)) {
    throw mapsStatus(200, stringField(body, "status"), stringField(body, "error_message"));
  }
  const distance = recordField(leg, "distance");
  const duration = recordField(leg, "duration");
  const traffic = recordField(leg, "duration_in_traffic");
  return {
    origin: firstNonEmpty(stringField(leg, "start_address"), origin),
    destination: firstNonEmpty(stringField(leg, "end_address"), destination),
    durationSeconds: numberField(duration, "value"),
    durationText: stringField(duration, "text") || undefined,
    durationInTrafficSeconds: traffic ? numberField(traffic, "value") || undefined : undefined,
    durationInTrafficText: stringField(traffic, "text") || undefined,
    distanceMeters: distance ? numberField(distance, "value") || undefined : undefined,
    distanceText: stringField(distance, "text") || undefined,
    summary: stringField(route, "summary") || undefined,
  };
}

export async function resolvePlace(client: MapsClient, fetchOpts: FetchGet, query: string): Promise<PlaceFields> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error(`query is required. ${nextPlaceResolve}`);
  }
  if (!client.apiKey.trim()) {
    throw new MissingKeyError();
  }
  const got = looksLikeMapsUrl(trimmed)
    ? await resolvePlaceFromLink(client, fetchOpts, trimmed)
    : await geocode(client, trimmed);
  return enrichPlace(client, got);
}

async function resolvePlaceFromLink(client: MapsClient, fetchOpts: FetchGet, query: string): Promise<PlaceFields> {
  const link = await resolveLink(query, fetchOpts);
  if (link.lat !== undefined && link.lng !== undefined) {
    const got = await reverseGeocode(client, link.lat, link.lng);
    if (link.name) {
      got.name = link.name;
    }
    got.query = query;
    return got;
  }
  const text = firstNonEmpty(link.name ?? "", link.destination ?? "", link.origin ?? "");
  if (!text) {
    throw new Error(`could not extract a place from that Maps URL. ${nextLinkResolve}`);
  }
  const got = await geocode(client, text);
  got.query = query;
  return got;
}

async function enrichPlace(client: MapsClient, got: PlaceFields): Promise<PlaceFields> {
  if (!got.placeId?.trim()) {
    return got;
  }
  try {
    const details = await placeDetails(client, got.placeId);
    if (details.name) {
      got.name = details.name;
    }
    if (details.address) {
      got.address = details.address;
    }
    got.rating = details.rating;
    got.ratings = details.ratings;
    got.openNow = details.openNow;
    got.url = firstNonEmpty(details.url ?? "", placeMapsUrl(got.name ?? "", got.placeId));
    got.website = details.website;
    got.reviews = details.reviews;
    return got;
  } catch {
    return got;
  }
}

export async function searchPlaces(client: MapsClient, fetchOpts: FetchGet, query: string, near: string, limit: number): Promise<SearchFields> {
  const trimmedQuery = query.trim();
  const trimmedNear = near.trim();
  if (!trimmedQuery) {
    throw new Error(`query is required. ${nextPlaceSearch}`);
  }
  if (!client.apiKey.trim()) {
    throw new MissingKeyError();
  }
  let capped = limit < 1 ? defaultSearchLimit : limit;
  capped = Math.min(capped, maxSearchLimit);
  const location = await resolveSearchLocation(client, fetchOpts, trimmedNear);
  let hits = await textSearch(client, trimmedQuery, location, defaultSearchRadiusM);
  if (hits.length > capped) {
    hits = hits.slice(0, capped);
  }
  return { query: trimmedQuery, near: trimmedNear || undefined, places: hits };
}

async function resolveSearchLocation(client: MapsClient, fetchOpts: FetchGet, near: string): Promise<string> {
  if (!near) {
    return "";
  }
  const pin = parseLatLng(near);
  if (pin) {
    return formatLatLng(pin.lat, pin.lng);
  }
  let text = near;
  if (looksLikeMapsUrl(near)) {
    const link = await resolveLink(near, fetchOpts);
    if (link.lat !== undefined && link.lng !== undefined) {
      return formatLatLng(link.lat, link.lng);
    }
    text = firstNonEmpty(link.name ?? "", link.destination ?? "", link.origin ?? "");
    if (!text) {
      throw new Error(`could not extract a location from that Maps URL. ${nextLinkResolve}`);
    }
  }
  const got = await geocode(client, text);
  return formatLatLng(got.lat, got.lng);
}

export function normalizeMode(mode: string): string {
  switch (mode.trim().toLowerCase()) {
    case "":
    case modeDriving:
    case "drive":
    case "car":
      return modeDriving;
    case modeWalking:
    case "walk":
      return modeWalking;
    case modeBicycling:
    case "bicycle":
    case "bike":
    case "cycling":
      return modeBicycling;
    case modeTransit:
    case "bus":
    case "train":
      return modeTransit;
    default:
      throw new Error(`mode must be driving, walking, bicycling, or transit. Next: route_eta(routes=[{"origin":"…","destination":"…","mode":"bicycling"}])`);
  }
}

export async function routeEta(client: MapsClient, fetchOpts: FetchGet, origin: string, destination: string, departureTime: string, mode: string): Promise<RouteFields> {
  const fromRaw = origin.trim();
  const toRaw = destination.trim();
  if (!fromRaw) {
    throw new Error(`origin is required. ${nextRouteEta}`);
  }
  if (!toRaw) {
    throw new Error(`destination is required. ${nextRouteEta}`);
  }
  if (!client.apiKey.trim()) {
    throw new MissingKeyError();
  }
  const travel = normalizeMode(mode);
  const from = await resolveWaypoint(fetchOpts, fromRaw, "origin");
  const to = await resolveWaypoint(fetchOpts, toRaw, "destination");
  const depart = parseDepartureTime(departureTime, client.now());
  const got = await directions(client, from, to, depart.param, travel);
  got.mode = travel;
  got.departureTime = formatRfc3339Utc(depart.at);
  const seconds = (got.durationInTrafficSeconds ?? 0) > 0 ? (got.durationInTrafficSeconds ?? 0) : got.durationSeconds;
  if (seconds > 0) {
    got.arrivalTime = formatRfc3339Utc(depart.at + seconds * 1000);
  }
  got.url = directionsUrl(from, to, travel);
  return got;
}

async function resolveWaypoint(fetchOpts: FetchGet, raw: string, prefer: "origin" | "destination"): Promise<string> {
  if (!looksLikeMapsUrl(raw)) {
    return raw;
  }
  const link: LinkFields = await resolveLink(raw, fetchOpts);
  if (prefer === "origin" && link.origin) {
    return link.origin;
  }
  if (prefer === "destination" && link.destination) {
    return link.destination;
  }
  if (link.lat !== undefined && link.lng !== undefined) {
    return formatLatLng(link.lat, link.lng);
  }
  const name = firstNonEmpty(link.name ?? "", link.destination ?? "", link.origin ?? "");
  if (name) {
    return name;
  }
  throw new Error(`could not extract a waypoint from that Maps URL. ${nextLinkResolve}`);
}

export function parseDepartureTime(value: string, nowMs: number): { param: string; at: number } {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "now") {
    return { param: "now", at: nowMs };
  }
  if (/^-?\d+$/.test(trimmed)) {
    const unix = Number(trimmed);
    if (unix > 1e8) {
      return { param: String(unix), at: unix * 1000 };
    }
  }
  if (!/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    throw new Error(`departure_time must be RFC3339, unix seconds, or "now". ${nextRouteEta}`);
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    throw new Error(`departure_time must be RFC3339, unix seconds, or "now". ${nextRouteEta}`);
  }
  return { param: String(Math.floor(at / 1000)), at };
}

export function formatRfc3339Utc(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

export function teachPlace(err: unknown, query: string): string {
  return teach(err, {
    denied: `GOOGLE_MAPS_API_KEY was rejected. Next: set a valid Maps Platform key on this process, then ${nextPlaceResolve.slice("Next: ".length)}`,
    zero: `no place found for ${JSON.stringify(query)}. ${nextPlaceResolve}`,
    quota: `Maps API quota exceeded. Next: wait, then place_resolve(queries=["…"])`,
    zeroStatuses: ["ZERO_RESULTS"],
  });
}

export function teachSearch(err: unknown, query: string): string {
  return teach(err, {
    denied: `GOOGLE_MAPS_API_KEY was rejected or Places API is not enabled. Next: enable Places API on the key, then ${nextPlaceSearch.slice("Next: ".length)}`,
    zero: `no places found for ${JSON.stringify(query)}. ${nextPlaceSearch}`,
    quota: `Maps API quota exceeded. Next: wait, then place_search(queries=["…"])`,
    zeroStatuses: ["ZERO_RESULTS"],
  });
}

export function teachRoute(err: unknown): string {
  return teach(err, {
    denied: `GOOGLE_MAPS_API_KEY was rejected. Next: set a valid Maps Platform key on this process, then ${nextRouteEta.slice("Next: ".length)}`,
    zero: `no route found. ${nextRouteEta}`,
    quota: `Maps API quota exceeded. Next: wait, then route_eta(routes=[{"origin":"…","destination":"…"}])`,
    zeroStatuses: ["ZERO_RESULTS", "NOT_FOUND"],
  });
}

function teach(err: unknown, copy: { denied: string; zero: string; quota: string; zeroStatuses: string[] }): string {
  if (err instanceof MapsApiError) {
    if (err.status === "REQUEST_DENIED") {
      return copy.denied;
    }
    if (copy.zeroStatuses.includes(err.status)) {
      return copy.zero;
    }
    if (err.status === "OVER_QUERY_LIMIT") {
      return copy.quota;
    }
    if (err.httpStatus === 401 || err.httpStatus === 403) {
      return copy.denied;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

async function apiGet(client: MapsClient, path: string, query: Record<string, string>, label: string): Promise<Record<string, unknown>> {
  const key = requireKey(client.apiKey);
  const base = client.baseUrl?.replace(/\/$/, "") || mapsBase;
  const params = { ...query, key };
  const url = `${base}${path}?${encodeQuery(params)}`;
  let response: Response;
  try {
    response = await client.fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: client.signal,
      headers: { Accept: "application/json", "User-Agent": mapsUserAgent },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message, { cause: err });
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxBytes) {
    throw new Error(`response larger than ${maxBytes} bytes`);
  }
  const text = new TextDecoder().decode(body);
  if (response.status !== 200) {
    throw parseApiError(response.status, text);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${label}: ${message}`, { cause: err });
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label}: invalid JSON`);
  }
  return parsed;
}

function parseApiError(httpStatus: number, text: string): MapsApiError {
  let status = "";
  let detail = "";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      status = stringField(parsed, "status");
      detail = stringField(parsed, "error_message");
    }
  } catch {
    // non-JSON error body
  }
  return mapsStatus(httpStatus, status, detail);
}

function mapsStatus(httpStatus: number, status: string, detail: string): MapsApiError {
  return new MapsApiError(httpStatus, status, detail);
}

function placeHitFromJson(row: Record<string, unknown>): PlaceHit {
  const geometry = recordField(row, "geometry");
  const location = geometry ? recordField(geometry, "location") : null;
  const name = stringField(row, "name");
  const placeId = stringField(row, "place_id");
  const hours = recordField(row, "opening_hours");
  const hit: PlaceHit = {
    placeId: placeId || undefined,
    name: name || undefined,
    address: firstNonEmpty(stringField(row, "formatted_address"), stringField(row, "vicinity")) || undefined,
    lat: numberField(location, "lat"),
    lng: numberField(location, "lng"),
    rating: numberField(row, "rating") || undefined,
    ratings: numberField(row, "user_ratings_total") || undefined,
    priceLevel: numberField(row, "price_level") || undefined,
    url: firstNonEmpty(stringField(row, "url"), placeMapsUrl(name, placeId)),
  };
  if (hours && "open_now" in hours) {
    hit.openNow = Boolean(hours.open_now);
  }
  return hit;
}

function placeResultFromJson(row: Record<string, unknown>): PlaceFields {
  const hit = placeHitFromJson(row);
  return {
    query: "",
    placeId: hit.placeId,
    name: hit.name,
    address: hit.address,
    lat: hit.lat,
    lng: hit.lng,
    rating: hit.rating,
    ratings: hit.ratings,
    url: hit.url,
    website: stringField(row, "website") || undefined,
    openNow: hit.openNow,
    reviews: clipReviews(arrayField(row, "reviews").filter(isRecord)),
  };
}

function clipReviews(rows: Record<string, unknown>[]): PlaceReview[] | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  return rows.slice(0, maxReviews).map((row) => {
    const text = clipReviewText(stringField(row, "text"));
    const review: PlaceReview = {};
    const author = stringField(row, "author_name");
    if (author) {
      review.author = author;
    }
    const rating = numberField(row, "rating");
    if (rating) {
      review.rating = rating;
    }
    if (text) {
      review.text = text;
    }
    const when = stringField(row, "relative_time_description");
    if (when) {
      review.when = when;
    }
    return review;
  });
}

function clipReviewText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxReviewChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxReviewChars).trim()}…`;
}

function placeName(components: unknown[], formatted: string): string {
  for (const component of components) {
    if (!isRecord(component)) {
      continue;
    }
    const types = arrayField(component, "types").filter((item): item is string => typeof item === "string");
    const longName = stringField(component, "long_name").trim();
    if (!longName) {
      continue;
    }
    for (const typ of types) {
      if (typ === "establishment" || typ === "point_of_interest" || typ === "premise" || typ === "airport" || typ === "park") {
        return longName;
      }
    }
  }
  if (!formatted) {
    return "";
  }
  const comma = formatted.indexOf(",");
  if (comma > 0) {
    return formatted.slice(0, comma).trim();
  }
  return formatted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordField(row: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!row) {
    return null;
  }
  const value = row[key];
  return isRecord(value) ? value : null;
}

function arrayField(row: Record<string, unknown> | null, key: string): unknown[] {
  if (!row) {
    return [];
  }
  const value = row[key];
  return Array.isArray(value) ? value : [];
}

function stringField(row: Record<string, unknown> | null, key: string): string {
  if (!row) {
    return "";
  }
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function numberField(row: Record<string, unknown> | null, key: string): number {
  if (!row) {
    return 0;
  }
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Google Maps share-link parsing. Host allowlist and redirect cap match the
 * Go fetcher so a short URL cannot be walked onto an arbitrary host.
 */
import { encodeQuery } from "./encode.ts";

export const maxBatch = 8;
export const maxRedirects = 5;
export const maxBytes = 2 << 20;
export const mapsUserAgent = "google-maps-mcp/0.1 (+https://github.com/shotah/google-maps-mcp)";

export const nextLinkResolve = `Next: link_resolve(urls=["https://maps.app.goo.gl/…"])`;
export const nextPlaceResolve = `Next: place_resolve(queries=["Space Needle"])`;
export const nextPlaceSearch = `Next: place_search(queries=["sushi restaurants"], near="Ballard")`;
export const nextRouteEta = `Next: route_eta(routes=[{"origin":"Seattle","destination":"Portland"}])`;

export const kindPlace = "place";
export const kindDirections = "directions";
export const kindSearch = "search";
export const kindView = "view";
export const kindUnknown = "unknown";

const atCoordsRe = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;
const dataCoordsRe = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;
const latLngPairRe = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/;

export type LinkFields = {
  url: string;
  canonical: string;
  kind: string;
  name?: string;
  lat?: number;
  lng?: number;
  origin?: string;
  destination?: string;
};

export class MapsFetchError extends Error {
  constructor(message: string, readonly finalUrl: string) {
    super(message);
    this.name = "MapsFetchError";
  }
}

export function goQuote(value: string): string {
  return JSON.stringify(value);
}

export function normalizeHost(host: string): string {
  let normalized = host.trim().toLowerCase().replace(/\.$/, "");
  const port = /^(.+):(\d+)$/.exec(normalized);
  if (port?.[1] && !port[1].includes(":")) {
    normalized = port[1];
  }
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function isAlpha(value: string): boolean {
  return value.length > 0 && /^[a-z]+$/.test(value);
}

export function isGoogleTld(rest: string): boolean {
  if (rest === "com") {
    return true;
  }
  if (rest.length === 2 && isAlpha(rest)) {
    return true;
  }
  if (rest.startsWith("co.") && rest.length === 5 && isAlpha(rest.slice(3))) {
    return true;
  }
  if (rest.startsWith("com.") && rest.length === 6 && isAlpha(rest.slice(4))) {
    return true;
  }
  return false;
}

export function allowedMapsHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized === "maps.app.goo.gl" || normalized === "goo.gl" || normalized === "g.co" || normalized === "google.com") {
    return true;
  }
  if (normalized.endsWith(".google.com")) {
    return true;
  }
  if (normalized.startsWith("www.google.")) {
    return isGoogleTld(normalized.slice("www.google.".length));
  }
  if (normalized.startsWith("maps.google.")) {
    return isGoogleTld(normalized.slice("maps.google.".length));
  }
  return false;
}

export function isShortMapsHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === "maps.app.goo.gl" || normalized === "goo.gl" || normalized === "g.co";
}

export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`url: ${message}`, { cause: err });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must be http or https");
  }
  if (!url.host) {
    throw new Error("url host is required");
  }
  return url;
}

export function isLongMapsUrl(url: URL | null): boolean {
  if (!url || !allowedMapsHost(url.host) || isShortMapsHost(url.host)) {
    return false;
  }
  return url.pathname.toLowerCase().includes("/maps");
}

export function looksLikeMapsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return false;
  }
  try {
    return allowedMapsHost(new URL(trimmed).host);
  } catch {
    return false;
  }
}

export function parseLatLng(value: string): { lat: number; lng: number } | null {
  const match = latLngPairRe.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return parseFloatPair(match[1], match[2]);
}

function parseFloatPair(a: string, b: string): { lat: number; lng: number } | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(a.trim()) || !/^-?\d+(?:\.\d+)?$/.test(b.trim())) {
    return null;
  }
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

export function formatLatLng(lat: number, lng: number): string {
  return `${formatFloat(lat)},${formatFloat(lng)}`;
}

/** strconv.FormatFloat(f, 'f', -1, 64) for ordinary coordinates. */
export function formatFloat(value: number): string {
  if (!Number.isFinite(value)) {
    return "NaN";
  }
  const text = Object.is(value, -0) ? "-0" : value.toString();
  if (!/[eE]/.test(text)) {
    return text;
  }
  return value.toFixed(16).replace(/\.?0+$/, "");
}

export function pathSegment(segment: string): string {
  const spaced = segment.replaceAll("+", " ");
  try {
    return decodeURIComponent(spaced).trim();
  } catch {
    return spaced.trim();
  }
}

export function parseMapsUrl(raw: string): LinkFields {
  const out: LinkFields = { url: "", canonical: "", kind: kindUnknown };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return out;
  }
  applyQueryEndpoints(out, url);
  applyPath(out, pathSegments(url.pathname));
  applyQueryName(out, url);
  applyCoords(out, raw, url.pathname, url);
  return out;
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((part) => part !== "");
}

function applyQueryEndpoints(out: LinkFields, url: URL): void {
  const origin = firstNonEmpty(url.searchParams.get("origin") ?? "", url.searchParams.get("saddr") ?? "");
  const destination = firstNonEmpty(url.searchParams.get("destination") ?? "", url.searchParams.get("daddr") ?? "");
  if (!origin && !destination) {
    return;
  }
  out.kind = kindDirections;
  if (origin) {
    out.origin = origin;
  }
  if (destination) {
    out.destination = destination;
  }
}

function applyPath(out: LinkFields, segments: string[]): void {
  const index = segments.findIndex((segment) => segment.toLowerCase() === "maps");
  if (index < 0 || index + 1 >= segments.length) {
    return;
  }
  const next = segments[index + 1] ?? "";
  const rest = segments[index + 2];
  switch (next.toLowerCase()) {
    case "place":
      out.kind = kindPlace;
      if (rest !== undefined && !isMetaSegment(rest)) {
        out.name = pathSegment(rest);
      }
      break;
    case "dir":
      out.kind = kindDirections;
      applyDirWaypoints(out, segments.slice(index + 2));
      break;
    case "search":
      out.kind = kindSearch;
      if (rest !== undefined && !isMetaSegment(rest)) {
        out.name = pathSegment(rest);
      }
      break;
    default:
      if (next.startsWith("@") && out.kind === kindUnknown) {
        out.kind = kindView;
      }
  }
}

function applyDirWaypoints(out: LinkFields, rest: string[]): void {
  const waypoints: string[] = [];
  for (const segment of rest) {
    if (isMetaSegment(segment)) {
      break;
    }
    waypoints.push(pathSegment(segment));
  }
  if (waypoints.length >= 1 && !out.origin) {
    out.origin = waypoints[0];
  }
  if (waypoints.length >= 2 && !out.destination) {
    const last = waypoints[waypoints.length - 1];
    if (last) {
      out.destination = last;
    }
  }
}

function applyQueryName(out: LinkFields, url: URL): void {
  const name = firstNonEmpty(url.searchParams.get("q") ?? "", url.searchParams.get("query") ?? "");
  if (!name || name.toLowerCase().startsWith("place_id:")) {
    return;
  }
  const pin = parseLatLng(name);
  if (pin) {
    if (out.lat === undefined) {
      out.lat = pin.lat;
      out.lng = pin.lng;
    }
    if (out.kind === kindUnknown) {
      out.kind = kindView;
    }
    return;
  }
  if (!out.name) {
    out.name = name;
  }
  if (out.kind === kindUnknown) {
    out.kind = kindSearch;
  }
}

function applyCoords(out: LinkFields, raw: string, path: string, url: URL): void {
  const data = extractPair(dataCoordsRe, raw);
  if (data && (out.kind === kindPlace || out.lat === undefined)) {
    out.lat = data.lat;
    out.lng = data.lng;
  }
  if (out.lat === undefined && out.kind !== kindDirections) {
    const at = extractPair(atCoordsRe, path);
    if (at) {
      out.lat = at.lat;
      out.lng = at.lng;
    }
  }
  if (out.lat === undefined) {
    const ll = parseLatLng(url.searchParams.get("ll") ?? "");
    if (ll) {
      out.lat = ll.lat;
      out.lng = ll.lng;
    }
  }
}

function extractPair(re: RegExp, value: string): { lat: number; lng: number } | null {
  const match = re.exec(value);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return parseFloatPair(match[1], match[2]);
}

function isMetaSegment(segment: string): boolean {
  return segment.startsWith("@") || segment.toLowerCase() === "data";
}

export function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

export type FetchGet = {
  fetch: typeof fetch;
  signal?: AbortSignal;
  allowHost?: (host: string) => boolean;
  maxBytes?: number;
};

export async function httpGet(rawUrl: string, opts: FetchGet): Promise<{ body: Uint8Array; contentType: string; finalUrl: string }> {
  const allow = opts.allowHost ?? allowedMapsHost;
  const limit = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : maxBytes;
  let current = rawUrl;
  for (let request = 1; request <= maxRedirects; request += 1) {
    if (opts.signal?.aborted) {
      throw new MapsFetchError("The operation was aborted", current);
    }
    const url = validateUrl(current);
    if (!allow(url.host)) {
      throw new MapsFetchError(`refusing non-Maps host ${goQuote(url.host)}`, current);
    }
    const response = await opts.fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: opts.signal,
      headers: {
        "User-Agent": mapsUserAgent,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (request >= maxRedirects) {
        throw new MapsFetchError(`stopped after ${maxRedirects} redirects`, current);
      }
      const location = response.headers.get("location") ?? "";
      let next: URL;
      try {
        next = new URL(location, current);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new MapsFetchError(`url: ${message}`, current);
      }
      try {
        validateUrl(next.href);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new MapsFetchError(message, current);
      }
      if (!allow(next.host)) {
        throw new MapsFetchError(`refusing redirect to non-Maps host ${goQuote(next.host)}`, current);
      }
      current = next.href;
      continue;
    }
    const finalUrl = current;
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new MapsFetchError(`GET ${finalUrl}: HTTP ${response.status}`, finalUrl);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > limit) {
      throw new MapsFetchError(`response larger than ${limit} bytes`, finalUrl);
    }
    let contentType = response.headers.get("content-type") ?? "";
    const semi = contentType.indexOf(";");
    if (semi >= 0) {
      contentType = contentType.slice(0, semi).trim();
    }
    return { body, contentType: contentType.toLowerCase(), finalUrl };
  }
  throw new MapsFetchError(`stopped after ${maxRedirects} redirects`, current);
}

export async function resolveLink(rawUrl: string, opts: FetchGet): Promise<LinkFields> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error(`url is required. ${nextLinkResolve}`);
  }
  const url = validateUrl(trimmed);
  if (!allowedMapsHost(url.host)) {
    throw new Error(`url host is not a Google Maps host. ${nextLinkResolve}`);
  }
  let canonical = trimmed;
  if (!isLongMapsUrl(url)) {
    canonical = await followShortUrl(trimmed, opts);
  }
  const parsed = parseMapsUrl(canonical);
  parsed.url = trimmed;
  parsed.canonical = canonical;
  return parsed;
}

async function followShortUrl(rawUrl: string, opts: FetchGet): Promise<string> {
  try {
    const got = await httpGet(rawUrl, opts);
    return got.finalUrl || rawUrl;
  } catch (err) {
    const finalUrl = err instanceof MapsFetchError ? err.finalUrl : "";
    if (finalUrl) {
      try {
        if (isLongMapsUrl(new URL(finalUrl))) {
          return finalUrl;
        }
      } catch {
        // fall through to the original fetch error
      }
    }
    throw err;
  }
}

export function directionsUrl(origin: string, destination: string, mode: string): string {
  return `https://www.google.com/maps/dir/?${encodeQuery({
    api: "1",
    origin,
    destination,
    travelmode: mode,
  })}`;
}

export function placeMapsUrl(name: string, placeId: string): string {
  const params: Record<string, string> = {
    api: "1",
    query: firstNonEmpty(name, placeId),
  };
  if (placeId) {
    params.query_place_id = placeId;
  }
  return `https://www.google.com/maps/search/?${encodeQuery(params)}`;
}

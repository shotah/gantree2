import { geoFromPosition, type GeoFix } from "./context";

export type GeoResult = { ok: true; geo: GeoFix } | { ok: false; reason: "denied" | "unavailable" };

type GeoApi = {
  getCurrentPosition: (
    success: (pos: GeolocationPosition) => void,
    error?: (err: GeolocationPositionError) => void,
    opts?: PositionOptions,
  ) => void;
};

/** Wait for a fresh lock on send. Longer when warming so the OS prompt can finish. */
export const GEO_TIMEOUT_MS = 8_000;
export const GEO_WARM_MS = 45_000;
/** Let the OS reuse a recent fix instead of waiting for a new satellite lock. */
export const GEO_MAX_AGE_MS = 30_000;
/** In-memory last pin for this page only. Never localStorage. */
export const GEO_CACHE_MS = 120_000;
const WATCHDOG_SLACK_MS = 2_000;

type GeoCache = { geo: GeoFix; at: number };

let cache: GeoCache | null = null;
let inflight: Promise<GeoResult> | null = null;

export function rememberGeo(geo: GeoFix, at = Date.now()): void {
  cache = { geo, at };
}

export function clearGeoCache(): void {
  cache = null;
  inflight = null;
}

export function cachedGeo(now = Date.now(), maxAge = GEO_CACHE_MS): GeoFix | null {
  if (!cache || now - cache.at > maxAge) {
    return null;
  }
  return cache.geo;
}

export function geoHint(enabled: boolean, geo: GeoResult | null): string {
  if (!enabled) {
    return "GPS off";
  }
  if (geo?.ok) {
    return `pin ±${Math.round(geo.geo.accuracy_m ?? 0)}m this send`;
  }
  return "GPS omitted (denied or unavailable)";
}

function failOrCache(reason: "denied" | "unavailable"): GeoResult {
  if (reason === "denied") {
    clearGeoCache();
    return { ok: false, reason: "denied" };
  }
  const geo = cachedGeo();
  if (geo) {
    return { ok: true, geo };
  }
  return { ok: false, reason: "unavailable" };
}

/** One-shot fix. Denied or missing API → omit geo. Never watchPosition. */
export function readGeo(api: GeoApi | null | undefined, timeoutMs = GEO_TIMEOUT_MS): Promise<GeoResult> {
  if (!api) {
    return Promise.resolve(failOrCache("unavailable"));
  }
  if (inflight) {
    return inflight;
  }
  inflight = new Promise<GeoResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(failOrCache("unavailable")), timeoutMs + WATCHDOG_SLACK_MS);
    function finish(result: GeoResult) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }
    try {
      api.getCurrentPosition(
        (pos) => {
          const geo = geoFromPosition(pos);
          rememberGeo(geo);
          finish({ ok: true, geo });
        },
        (err) => {
          finish(failOrCache(err.code === 1 ? "denied" : "unavailable"));
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: GEO_MAX_AGE_MS },
      );
    } catch {
      finish(failOrCache("unavailable"));
    }
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

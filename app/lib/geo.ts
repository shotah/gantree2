import { GEO_TIMEOUT_MS, readGeo, type GeoResult } from "@/lib/phone/geo";

export function browserGeo(timeoutMs = GEO_TIMEOUT_MS): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: "unavailable" });
  }
  return readGeo(navigator.geolocation, timeoutMs);
}

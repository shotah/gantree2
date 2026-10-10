import { afterEach, describe, expect, it } from "vitest";
import {
  cachedGeo,
  clearGeoCache,
  GEO_MAX_AGE_MS,
  GEO_TIMEOUT_MS,
  geoHint,
  readGeo,
} from "@/lib/phone/geo";

function pos(lat: number, lon: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() {
        return {};
      },
    },
    timestamp: 1,
    toJSON() {
      return {};
    },
  };
}

afterEach(() => {
  clearGeoCache();
});

describe("readGeo", () => {
  it("omits when the API is missing", async () => {
    expect(await readGeo(null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns a fix on success and denied on permission error", async () => {
    const ok = await readGeo({
      getCurrentPosition(success) {
        success(pos(1, 2, 3));
      },
    });
    expect(ok).toEqual({ ok: true, geo: { lat: 1, lon: 2, accuracy_m: 3 } });

    const denied = await readGeo({
      getCurrentPosition(_s, error) {
        error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });
    expect(denied).toEqual({ ok: false, reason: "denied" });
    expect(cachedGeo()).toBeNull();
  });

  it("asks the OS for a cached fix instead of a zero-age lock", async () => {
    let opts: PositionOptions | undefined;
    await readGeo({
      getCurrentPosition(success, _error, o) {
        opts = o;
        success(pos(1, 2, 3));
      },
    });
    expect(opts).toEqual({
      enableHighAccuracy: true,
      timeout: GEO_TIMEOUT_MS,
      maximumAge: GEO_MAX_AGE_MS,
    });
  });

  it("reuses a fresh fix when the next read times out", async () => {
    await readGeo({
      getCurrentPosition(success) {
        success(pos(1, 2, 3));
      },
    });
    const miss = await readGeo({
      getCurrentPosition(_s, error) {
        error?.({ code: 3, message: "timeout", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      },
    });
    expect(miss).toEqual({ ok: true, geo: { lat: 1, lon: 2, accuracy_m: 3 } });
  });

  it("formats a compose hint", () => {
    expect(geoHint(false, null)).toBe("GPS off");
    expect(geoHint(true, { ok: false, reason: "denied" })).toBe("GPS omitted (denied or unavailable)");
    expect(geoHint(true, { ok: true, geo: { lat: 1, lon: 2, accuracy_m: 12.4 } })).toBe("pin ±12m this send");
  });

  it("shares one in-flight OS read", async () => {
    let calls = 0;
    const api = {
      getCurrentPosition(success: (p: GeolocationPosition) => void) {
        calls += 1;
        success(pos(1, 2, 3));
      },
    };
    const [a, b] = await Promise.all([readGeo(api), readGeo(api)]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: true, geo: { lat: 1, lon: 2, accuracy_m: 3 } });
  });
});

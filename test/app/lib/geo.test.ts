import { afterEach, describe, expect, it, vi } from "vitest";
import { browserGeo } from "@/app/lib/geo";
import { clearGeoCache } from "@/lib/phone/geo";

afterEach(() => {
  clearGeoCache();
  vi.unstubAllGlobals();
});

describe("browserGeo", () => {
  it("is unavailable without navigator.geolocation", async () => {
    expect(await browserGeo()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("delegates when geolocation exists", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition(success: (p: GeolocationPosition) => void) {
          success({
            coords: {
              latitude: 9,
              longitude: 8,
              accuracy: 4,
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
          });
        },
      },
    });
    expect(await browserGeo()).toEqual({ ok: true, geo: { lat: 9, lon: 8, accuracy_m: 4 } });
  });
});

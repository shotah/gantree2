import { describe, expect, it } from "vitest";
import { buildContext, geoFromPosition, wireContext } from "@/lib/phone/context";

describe("phone context", () => {
  it("sends geo only unless extra fields are passed", () => {
    const withGeo = buildContext({
      geo: { lat: 47.6, lon: -122.3, accuracy_m: 8 },
    });
    expect(withGeo).toEqual({ geo: { lat: 47.6, lon: -122.3, accuracy_m: 8 } });
    expect(wireContext(withGeo)).toEqual(withGeo);
    const denied = buildContext({ geo: null });
    expect(denied).toEqual({});
    expect(wireContext(denied)).toBeUndefined();
  });

  it("still accepts at tz battery net surface when a mouth passes them", () => {
    const now = new Date("2026-09-04T20:00:00.000Z");
    expect(buildContext({
      now,
      timeZone: "America/Los_Angeles",
      geo: { lat: 47.6, lon: -122.3 },
      net: "cellular",
      battery: { pct: 40, charging: true },
      surface: "android_auto",
    })).toEqual({
      at: "2026-09-04T20:00:00.000Z",
      tz: "America/Los_Angeles",
      geo: { lat: 47.6, lon: -122.3 },
      net: "cellular",
      battery: { pct: 40, charging: true },
      surface: "android_auto",
    });
  });

  it("stamps input spoken on a hold-to-talk turn and keeps it on the wire without geo", () => {
    const spoken = buildContext({ geo: null, input: "spoken" });
    expect(spoken).toEqual({ input: "spoken" });
    expect(wireContext(spoken)).toEqual({ input: "spoken" });
    expect(buildContext({ geo: { lat: 1, lon: 2 } })).not.toHaveProperty("input");
  });

  it("maps a GeolocationPosition-shaped fix", () => {
    expect(geoFromPosition({
      coords: {
        latitude: 1,
        longitude: 2,
        accuracy: 5,
        altitude: 10,
        heading: 180,
        speed: 0.5,
      },
    })).toEqual({
      lat: 1,
      lon: 2,
      accuracy_m: 5,
      alt_m: 10,
      heading: 180,
      speed_mps: 0.5,
    });
  });
});

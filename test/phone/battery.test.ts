import { describe, expect, it } from "vitest";
import { readBattery } from "@/lib/phone/battery";

describe("readBattery", () => {
  it("omits when the API is missing", async () => {
    expect(await readBattery(undefined)).toEqual({ ok: false });
  });

  it("clamps percent and keeps charging", async () => {
    expect(await readBattery(async () => ({ level: 0.4, charging: true }))).toEqual({
      ok: true,
      battery: { pct: 40, charging: true },
    });
    expect(await readBattery(async () => ({ level: 1.4, charging: false }))).toEqual({
      ok: true,
      battery: { pct: 100, charging: false },
    });
    expect(await readBattery(async () => ({ level: Number.NaN, charging: false }))).toEqual({ ok: false });
  });

  it("omits when getBattery throws", async () => {
    expect(await readBattery(async () => {
      throw new Error("nope");
    })).toEqual({ ok: false });
  });
});

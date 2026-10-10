import { describe, expect, it, vi } from "vitest";
import { browserBattery } from "@/app/lib/battery";

describe("browserBattery", () => {
  it("is omitted without getBattery", async () => {
    expect(await browserBattery()).toEqual({ ok: false });
  });

  it("delegates when getBattery exists", async () => {
    vi.stubGlobal("navigator", {
      getBattery: async () => ({ level: 0.8, charging: false }),
    });
    expect(await browserBattery()).toEqual({ ok: true, battery: { pct: 80, charging: false } });
    vi.unstubAllGlobals();
  });
});

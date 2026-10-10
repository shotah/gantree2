/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeoEnable } from "@/app/components/chat/GeoEnable";
import { clearGeoCache } from "@/lib/phone/geo";

afterEach(() => {
  cleanup();
  clearGeoCache();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "permissions");
  Reflect.deleteProperty(navigator, "geolocation");
});

function pos(): GeolocationPosition {
  return {
    coords: {
      latitude: 1,
      longitude: 2,
      accuracy: 8,
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

function stubGeo(opts: {
  state?: PermissionState;
  fix?: "ok" | "denied";
}) {
  const status = { state: opts.state ?? "prompt", onchange: null as (() => void) | null };
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(async () => status) },
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition(
        success: (p: GeolocationPosition) => void,
        error?: (e: GeolocationPositionError) => void,
      ) {
        if (opts.fix === "denied") {
          error?.({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
          return;
        }
        success(pos());
      },
    },
  });
  return { status };
}

describe("GeoEnable", () => {
  it("prompts for a fix then turns sending on", async () => {
    stubGeo({ state: "prompt", fix: "ok" });
    const onToggle = vi.fn();
    render(<GeoEnable sending={false} onToggle={onToggle} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Enable location" }));
    });
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "On" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles sending once the OS has granted", async () => {
    stubGeo({ state: "granted" });
    const onToggle = vi.fn();
    const { rerender } = render(<GeoEnable sending onToggle={onToggle} />);
    expect(await screen.findByRole("button", { name: "On" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "On" }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<GeoEnable sending={false} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows Blocked when the OS denied location", async () => {
    stubGeo({ state: "denied" });
    render(<GeoEnable sending onToggle={vi.fn()} />);
    expect(await screen.findByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Blocked — enable in system settings.")).toBeTruthy();
  });

  it("shows Blocked when the prompt is refused", async () => {
    stubGeo({ state: "prompt", fix: "denied" });
    const onToggle = vi.fn();
    render(<GeoEnable sending={false} onToggle={onToggle} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Enable location" }));
    });
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText("Blocked")).toBeTruthy();
  });
});

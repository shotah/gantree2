/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicEnable } from "@/app/components/chat/MicEnable";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "permissions");
  Reflect.deleteProperty(navigator, "mediaDevices");
});

function stubMic(opts: {
  state?: PermissionState;
  gum?: () => Promise<{ getTracks: () => { stop: () => void }[] }>;
}) {
  const status = { state: opts.state ?? "prompt", onchange: null as (() => void) | null };
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: {
      query: vi.fn(async () => status),
    },
  });
  const gum = opts.gum ?? vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: gum },
  });
  return { status, gum };
}

describe("MicEnable", () => {
  it("asks getUserMedia then shows On and stops the tracks", async () => {
    const stop = vi.fn();
    const { gum } = stubMic({
      gum: vi.fn(async () => ({ getTracks: () => [{ stop }] })),
    });
    render(<MicEnable />);
    expect(await screen.findByRole("button", { name: "Enable microphone" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable microphone" }));
    });
    expect(gum).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable microphone" })).toBeNull();
  });

  it("asks getUserMedia even when the query already says denied", async () => {
    const stop = vi.fn();
    const { gum } = stubMic({
      state: "denied",
      gum: vi.fn(async () => ({ getTracks: () => [{ stop }] })),
    });
    render(<MicEnable />);
    expect(await screen.findByRole("button", { name: "Enable microphone" })).toBeTruthy();
    expect(screen.queryByText("Blocked — enable in system settings.")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable microphone" }));
    });
    expect(gum).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("keeps Enable clickable after getUserMedia is refused", async () => {
    stubMic({
      gum: vi.fn(async () => {
        const err = new Error("no");
        err.name = "NotAllowedError";
        throw err;
      }),
    });
    render(<MicEnable />);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Enable microphone" }));
    });
    expect(screen.getByText("Blocked — enable in system settings.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable microphone" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enable microphone" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

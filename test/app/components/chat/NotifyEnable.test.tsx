/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotifyEnable } from "@/app/components/chat/NotifyEnable";
import { PushRegister, PushTestFail, type PushTestCounts } from "@/lib/phone/pushState";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "matchMedia");
});

function stubNotification(permission: NotificationPermission, request = vi.fn(async () => permission)) {
  const constructed: { title: string; opts?: NotificationOptions }[] = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = request;
    constructor(title: string, opts?: NotificationOptions) {
      constructed.push({ title, opts });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { FakeNotification, constructed, request };
}

describe("NotifyEnable", () => {
  it("asks the OS and sends a test ping when granted", async () => {
    const onGranted = vi.fn(() => PushRegister.Ok);
    const { FakeNotification, constructed, request } = stubNotification("default", vi.fn(async () => {
      FakeNotification.permission = "granted";
      return "granted" as const;
    }));
    render(<NotifyEnable onGranted={onGranted} />);
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
    });
    expect(request).toHaveBeenCalledOnce();
    expect(onGranted).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Test" })).toBeTruthy();
    expect(screen.getByText("Sent a test ping.")).toBeTruthy();
    expect(constructed).toHaveLength(1);
    constructed.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
    });
    expect(constructed).toHaveLength(1);
  });

  it("says why lock-screen push did not register", async () => {
    const { FakeNotification, request } = stubNotification("default", vi.fn(async () => {
      FakeNotification.permission = "granted";
      return "granted" as const;
    }));
    render(<NotifyEnable onGranted={async () => PushRegister.NoVapid} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
    });
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText(
      "Granted, but lock-screen push did not register. This Worker has no VAPID keys — local toasts only.",
    )).toBeTruthy();
  });

  it("Test asks the Worker for a real push and reports what the push service said", async () => {
    const { constructed } = stubNotification("granted");
    const onTest = vi.fn(async (): Promise<PushTestCounts> => ({ rows: 1, ok: 1, gone: 0, fail: 0, statuses: [] }));
    render(<NotifyEnable onTest={onTest} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
    });
    expect(onTest).toHaveBeenCalledOnce();
    expect(constructed).toHaveLength(0);
    expect(screen.getByText("Lock-screen ping sent to 1 device. If nothing showed, the browser dropped it.")).toBeTruthy();

    onTest.mockResolvedValueOnce({ rows: 1, ok: 0, gone: 0, fail: 1, statuses: [403] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
    });
    expect(screen.getByText(
      "Push service refused (VAPID keys do not match this subscription) — tap Enable again.",
    )).toBeTruthy();

    onTest.mockResolvedValueOnce({ rows: 0, ok: 0, gone: 0, fail: 0, statuses: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
    });
    expect(screen.getByText("No lock-screen subscription for this room — tap Enable again.")).toBeTruthy();
  });

  it("Test falls back to a local toast and says so when the Worker has no VAPID keys", async () => {
    const { constructed } = stubNotification("granted");
    render(<NotifyEnable onTest={async () => PushTestFail.NoVapid} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test" }));
    });
    expect(constructed).toHaveLength(1);
    expect(screen.getByText(
      "Local toast only — this Worker has no VAPID keys, so nothing reaches a locked phone.",
    )).toBeTruthy();
  });

  it("still asks when the OS says denied, then keeps the hint if the prompt fails", async () => {
    const { request } = stubNotification("denied", vi.fn(async () => "denied" as const));
    render(<NotifyEnable />);
    expect(screen.queryByText("Blocked — enable in system settings.")).toBeNull();
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
    });
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText("Blocked — enable in system settings.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enable notifications" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("prompts when the OS said denied but requestPermission grants", async () => {
    const { FakeNotification, request } = stubNotification("denied", vi.fn(async () => {
      FakeNotification.permission = "granted";
      return "granted" as const;
    }));
    render(<NotifyEnable />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));
    });
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Test" })).toBeTruthy();
  });

  it("tells iPhone to install before enabling", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      permissions: undefined,
    });
    render(<NotifyEnable />);
    expect(screen.getByText("Install the app first, then enable.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enable notifications" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { browserAskNotify, browserNotifyIncoming, browserShowNotify, notifyPermission } from "@/app/lib/notify";
import { NOTIFY_TEST } from "@/lib/phone/notify";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
});

describe("browser notify", () => {
  it("is unsupported without Notification", async () => {
    expect(notifyPermission()).toBe("unsupported");
    expect(await browserAskNotify()).toBe("unsupported");
    expect(await browserShowNotify(NOTIFY_TEST)).toBe(false);
  });

  it("asks and shows through the Notification constructor", async () => {
    const constructed: { title: string; opts?: NotificationOptions }[] = [];
    class FakeNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = vi.fn(async () => {
        FakeNotification.permission = "granted";
        return "granted" as const;
      });

      constructor(title: string, opts?: NotificationOptions) {
        constructed.push({ title, opts });
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    expect(notifyPermission()).toBe("default");
    expect(await browserAskNotify()).toBe("granted");
    expect(await browserShowNotify(NOTIFY_TEST)).toBe(true);
    expect(constructed).toEqual([expect.objectContaining({ title: "gantree" })]);
  });

  it("prefers the service worker registration", async () => {
    const showNotification = vi.fn(async () => undefined);
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      constructor() {
        throw new Error("should use the SW");
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ showNotification }) },
    });
    expect(await browserShowNotify(NOTIFY_TEST)).toBe(true);
    expect(showNotification).toHaveBeenCalledOnce();
  });

  it("falls back to the constructor when getRegistration throws", async () => {
    const constructed: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string) {
        constructed.push(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => {
        throw new Error("no sw");
      } },
    });
    expect(await browserShowNotify(NOTIFY_TEST)).toBe(true);
    expect(constructed).toEqual(["gantree"]);
  });

  it("uses the constructor when no registration is stored", async () => {
    const constructed: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string) {
        constructed.push(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => undefined },
    });
    expect(await browserShowNotify(NOTIFY_TEST)).toBe(true);
    expect(constructed).toEqual(["gantree"]);
  });

  it("toasts a hidden reply and skips a visible one", async () => {
    const constructed: string[] = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      constructor(title: string) {
        constructed.push(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    browserNotifyIncoming({ kind: "reply", title: "Kit", text: "yo" });
    await Promise.resolve();
    expect(constructed).toEqual([]);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    browserNotifyIncoming({ kind: "reply", title: "Kit", text: "yo" });
    await Promise.resolve();
    expect(constructed).toEqual(["Kit"]);
    constructed.length = 0;
    browserNotifyIncoming({ kind: "inbound", title: "Kit", text: "from me" });
    await Promise.resolve();
    expect(constructed).toEqual([]);
  });
});

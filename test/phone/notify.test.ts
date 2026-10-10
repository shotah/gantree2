import { describe, expect, it, vi } from "vitest";
import {
  NOTIFY_ICON,
  NOTIFY_TEST,
  notifyAskState,
  notifyBody,
  notifyHint,
  notifyNeedHomeScreen,
  presentNotify,
  readNotifyPermission,
  requestNotifyPermission,
  shouldNotify,
} from "@/lib/phone/notify";

describe("notify", () => {
  it("only toasts hidden push and reply when granted", () => {
    expect(shouldNotify(false, "push", "granted")).toBe(false);
    expect(shouldNotify(true, "push", "granted")).toBe(true);
    expect(shouldNotify(true, "reply", "granted")).toBe(true);
    expect(shouldNotify(true, "push", "default")).toBe(false);
    expect(shouldNotify(true, "inbound", "granted")).toBe(false);
    expect(shouldNotify(true, "cmds", "granted")).toBe(false);
    expect(shouldNotify(true, "draft", "granted")).toBe(false);
    expect(shouldNotify(true, "push", "granted", true)).toBe(false);
  });

  it("reads permission and names the install / blocked gaps", () => {
    expect(readNotifyPermission(undefined)).toBe("unsupported");
    expect(readNotifyPermission({})).toBe("unsupported");
    expect(readNotifyPermission({ permission: "granted" })).toBe("granted");
    expect(readNotifyPermission({ permission: "nope" })).toBe("unsupported");
    expect(notifyNeedHomeScreen(true, false)).toBe(true);
    expect(notifyNeedHomeScreen(true, true)).toBe(false);
    expect(notifyNeedHomeScreen(false, false)).toBe(false);
    expect(notifyHint({ permission: "default", needHomeScreen: true })).toBe(
      "Install the app first, then enable.",
    );
    expect(notifyHint({ permission: "unsupported", needHomeScreen: false })).toBe(
      "Not available in this browser.",
    );
    expect(notifyHint({ permission: "denied", needHomeScreen: false })).toBe(
      "Blocked — enable in system settings.",
    );
    expect(notifyHint({ permission: "granted", needHomeScreen: false })).toBe("");
  });

  it("does not treat a notifications denied as a stop until requestPermission runs", () => {
    expect(notifyAskState("denied", false)).toBe("default");
    expect(notifyAskState("default", false)).toBe("default");
    expect(notifyAskState("denied", true)).toBe("denied");
    expect(notifyAskState("granted", false)).toBe("granted");
    expect(notifyAskState("unsupported", false)).toBe("unsupported");
  });

  it("truncates the toast body", () => {
    expect(notifyBody("  yo  ")).toBe("yo");
    expect(notifyBody("", true)).toBe("Photo");
    expect(notifyBody(undefined)).toBe("New message");
    expect(notifyBody("a".repeat(141)).length).toBe(140);
    expect(notifyBody("a".repeat(141)).endsWith("…")).toBe(true);
  });

  it("asks the OS and falls back when request throws", async () => {
    expect(await requestNotifyPermission(undefined)).toBe("unsupported");
    expect(await requestNotifyPermission({ permission: "default" })).toBe("unsupported");
    expect(await requestNotifyPermission({
      permission: "default",
      requestPermission: () => "granted",
    })).toBe("granted");
    expect(await requestNotifyPermission({
      permission: "denied",
      requestPermission: () => {
        throw new Error("blocked");
      },
    })).toBe("denied");
    expect(await requestNotifyPermission({
      permission: "weird",
      requestPermission: async () => "nope",
    })).toBe("denied");
  });

  it("shows via the service worker, then the constructor", async () => {
    const showNotification = vi.fn(async () => undefined);
    expect(await presentNotify(NOTIFY_TEST, { permission: "default" })).toBe(false);
    expect(await presentNotify(NOTIFY_TEST, {
      permission: "granted",
      registration: { showNotification },
    })).toBe(true);
    expect(showNotification).toHaveBeenCalledWith("gantree", expect.objectContaining({
      body: "Notifications are on.",
      icon: NOTIFY_ICON,
      tag: "gantree",
    }));
    const constructed: string[] = [];
    class Fake {
      constructor(title: string) {
        constructed.push(title);
      }
    }
    expect(await presentNotify(NOTIFY_TEST, {
      permission: "granted",
      registration: {
        showNotification: () => {
          throw new Error("no sw toast");
        },
      },
      Notification: Fake,
    })).toBe(true);
    expect(constructed).toEqual(["gantree"]);
    expect(await presentNotify(NOTIFY_TEST, { permission: "granted" })).toBe(false);
    class Boom {
      constructor() {
        throw new Error("blocked");
      }
    }
    expect(await presentNotify(NOTIFY_TEST, {
      permission: "granted",
      Notification: Boom,
    })).toBe(false);
  });
});

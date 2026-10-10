/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { browserRegisterPush, browserTestPush } from "@/app/lib/push";
import { PushRegister, PushTestFail } from "@/lib/phone/pushState";
import { encodeBase64Url, generateVapidKeys, vapidPublicKeyBytes } from "@/lib/chat/push/vapid";

afterEach(() => {
  vi.unstubAllGlobals();
});

function granted() {
  class FakeNotification {
    static permission: NotificationPermission = "granted";
  }
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("PushManager", class PushManager {});
}

function fakeSubscription(endpoint: string) {
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  const auth = new Uint8Array(16);
  return { endpoint, keys: { p256dh: encodeBase64Url(pub), auth: encodeBase64Url(auth) } };
}

describe("browserRegisterPush", () => {
  it("names why it skipped: permission, then the Push API", async () => {
    expect(await browserRegisterPush("kit")).toBe(PushRegister.NoPermission);
    class FakeNotification {
      static permission: NotificationPermission = "granted";
    }
    vi.stubGlobal("Notification", FakeNotification);
    expect(await browserRegisterPush("kit")).toBe(PushRegister.NoPushApi);
  });

  it("subscribes after Google and PUTs the endpoint", async () => {
    const keys = await generateVapidKeys();
    const subscription = fakeSubscription("https://fcm.googleapis.com/fcm/send/ada");
    const subscribe = vi.fn(async () => ({ toJSON: () => subscription }));
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.includes("/api/chat/push")) {
        return Response.json({ publicKey: keys.publicKey });
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { slug?: string };
        expect(body.slug).toBe("kit");
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    });
    granted();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => null, subscribe },
        }),
      },
    });
    expect(await browserRegisterPush("kit")).toBe(PushRegister.Ok);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses a subscription made for this VAPID key", async () => {
    const keys = await generateVapidKeys();
    const applicationServerKey = vapidPublicKeyBytes(keys.publicKey) as Uint8Array;
    const toJSON = vi.fn(() => fakeSubscription("https://fcm.googleapis.com/fcm/send/old"));
    const unsubscribe = vi.fn(async () => true);
    granted();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Response.json({ ok: true });
      }
      return Response.json({ publicKey: keys.publicKey });
    }));
    const subscribe = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({
              toJSON,
              unsubscribe,
              options: { applicationServerKey: applicationServerKey.buffer },
            }),
            subscribe,
          },
        }),
      },
    });
    expect(await browserRegisterPush("kit")).toBe(PushRegister.Ok);
    expect(subscribe).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(await browserRegisterPush("")).toBe(PushRegister.Rejected);
  });

  it("drops a subscription bound to an older VAPID key and makes a new one", async () => {
    const keys = await generateVapidKeys();
    const stale = await generateVapidKeys();
    const staleKey = vapidPublicKeyBytes(stale.publicKey) as Uint8Array;
    const unsubscribe = vi.fn(async () => true);
    const fresh = fakeSubscription("https://fcm.googleapis.com/fcm/send/new");
    const subscribe = vi.fn(async () => ({ toJSON: () => fresh }));
    let put: { subscription?: { endpoint?: string } } = {};
    granted();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === "PUT") {
        put = JSON.parse(String(init.body)) as typeof put;
        return Response.json({ ok: true });
      }
      return Response.json({ publicKey: keys.publicKey });
    }));
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({
              toJSON: () => fakeSubscription("https://fcm.googleapis.com/fcm/send/old"),
              unsubscribe,
              options: { applicationServerKey: staleKey.buffer },
            }),
            subscribe,
          },
        }),
      },
    });
    expect(await browserRegisterPush("kit")).toBe(PushRegister.Ok);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(put.subscription?.endpoint).toBe("https://fcm.googleapis.com/fcm/send/new");
  });

  it("says no-vapid when the Worker has no keys and unauthorized when signed out", async () => {
    granted();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({}) } });
    expect(await browserRegisterPush("kit")).toBe(PushRegister.NoVapid);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    expect(await browserRegisterPush("kit")).toBe(PushRegister.Unauthorized);
  });

  it("says rejected when the Worker refuses the subscription", async () => {
    const keys = await generateVapidKeys();
    granted();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Response.json({ error: "bad frame" }, { status: 400 });
      }
      return Response.json({ publicKey: keys.publicKey });
    }));
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => ({ toJSON: () => fakeSubscription("https://evil.example/x") }),
          },
        }),
      },
    });
    expect(await browserRegisterPush("kit")).toBe(PushRegister.Rejected);
  });
});

describe("browserTestPush", () => {
  it("POSTs the slug and returns the Worker's counts", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ slug: "kit" });
      return Response.json({ rows: 2, ok: 1, gone: 0, fail: 1, statuses: [403] });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await browserTestPush("kit")).toEqual({ rows: 2, ok: 1, gone: 0, fail: 1, statuses: [403] });
  });

  it("maps 404 to no-vapid, 401 to unauthorized, and anything else to failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(await browserTestPush("kit")).toBe(PushTestFail.NoVapid);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    expect(await browserTestPush("kit")).toBe(PushTestFail.Unauthorized);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    expect(await browserTestPush("kit")).toBe(PushTestFail.Failed);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(await browserTestPush("kit")).toBe(PushTestFail.Failed);
    expect(await browserTestPush("")).toBe(PushTestFail.Failed);
  });
});

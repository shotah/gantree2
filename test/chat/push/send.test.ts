import { describe, expect, it, vi } from "vitest";
import { PUSH_TTL_SEC, sendWebPush } from "@/lib/chat/push/send";
import { encodeBase64Url, generateVapidKeys, readVapid } from "@/lib/chat/push/vapid";

async function fakeClientSub() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
    keys: { p256dh: encodeBase64Url(raw), auth: encodeBase64Url(auth) },
  };
}

describe("send web push", () => {
  it("POSTs an encrypted body and maps gone / success / fail", async () => {
    const keys = await generateVapidKeys();
    const vapid = readVapid({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: JSON.stringify(keys.privateJwk),
      VAPID_SUBJECT: "mailto:ada@example.com",
    });
    if (!vapid) {
      throw new Error("expected vapid credentials");
    }
    const subscription = await fakeClientSub();
    const fetchOk = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(subscription.endpoint);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("ttl")).toBe(String(PUSH_TTL_SEC));
      expect(headers.get("urgency")).toBe("high");
      expect(init?.body).toBeInstanceOf(ArrayBuffer);
      return new Response(null, { status: 201 });
    });
    expect(await sendWebPush({
      vapid,
      subscription,
      payload: { title: "Kit", body: "yo" },
      fetch: fetchOk as unknown as typeof fetch,
    })).toBe("ok");
    expect(fetchOk).toHaveBeenCalledOnce();

    expect(await sendWebPush({
      vapid,
      subscription,
      payload: { title: "Kit", body: "yo" },
      fetch: vi.fn(async () => new Response(null, { status: 410 })),
    })).toBe("gone");
    expect(await sendWebPush({
      vapid,
      subscription,
      payload: { title: "Kit", body: "yo" },
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
    })).toBe("gone");
    expect(await sendWebPush({
      vapid,
      subscription,
      payload: { title: "Kit", body: "yo" },
      fetch: vi.fn(async () => new Response(null, { status: 500 })),
    })).toBe("fail");
    expect(await sendWebPush({
      vapid,
      subscription,
      payload: { title: "Kit", body: "yo" },
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    })).toBe("fail");
  });

  it("fails closed on a junk subscription instead of throwing", async () => {
    const keys = await generateVapidKeys();
    const vapid = readVapid({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: JSON.stringify(keys.privateJwk),
    });
    if (!vapid) {
      throw new Error("expected vapid credentials");
    }
    expect(await sendWebPush({
      vapid,
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/bad",
        keys: { p256dh: "nope", auth: "nope" },
      },
      payload: { title: "Kit", body: "yo" },
      fetch: vi.fn(async () => new Response(null, { status: 201 })),
    })).toBe("fail");
  });
});

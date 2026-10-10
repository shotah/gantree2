import { describe, expect, it, vi } from "vitest";
import { fanWebPush, pushPayload, testWebPush } from "@/lib/chat/push/fan";
import { PushSend } from "@/lib/chat/push/send";
import type { PushSub, StoredPush } from "@/lib/chat/push/subscription";
import { encodeBase64Url } from "@/lib/chat/push/vapid";

function row(userId: string, n: number): StoredPush {
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  const auth = new Uint8Array(16);
  auth[0] = n;
  return {
    userId,
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${userId}-${n}`,
      keys: { p256dh: encodeBase64Url(pub), auth: encodeBase64Url(auth) },
    },
    at: n,
  };
}

describe("fan web push", () => {
  it("builds a truncated payload and skips inbound", () => {
    expect(pushPayload({ text: "yo" }, "kit")).toEqual({
      title: "Kit",
      body: "yo",
      tag: "chat",
    });
    expect(pushPayload({ images: [{ url: "data:image/jpeg;base64,aa" }] }, "  ")).toEqual({
      title: "Kit",
      body: "Photo",
      tag: "chat",
    });
  });

  it("sends even when the phone socket still looks live", async () => {
    const send = vi.fn(async () => "ok" as const);
    const ada = row("ada", 1);
    const gone = await fanWebPush({
      frame: { kind: "reply", user_id: "ada", text: "yo" },
      title: "Kit",
      stored: [ada],
      send,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(ada.subscription, { title: "Kit", body: "yo", tag: "chat" });
    expect(gone.gone).toEqual([]);
  });

  it("sends a cron broadcast to stored phones and drops gone endpoints", async () => {
    const send = vi.fn(async (sub: PushSub): Promise<"gone" | "ok"> => sub.endpoint.includes("bob") ? "gone" : "ok");
    const ada = row("ada", 1);
    const bob = row("bob", 2);
    const result = await fanWebPush({
      frame: { kind: "push", text: "leave by 8" },
      title: "Kit",
      stored: [ada, bob],
      send,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(ada.subscription, { title: "Kit", body: "leave by 8", tag: "chat" });
    expect(send).toHaveBeenCalledWith(bob.subscription, { title: "Kit", body: "leave by 8", tag: "chat" });
    expect(result.gone).toEqual([bob]);
  });

  it("skips cmds", async () => {
    const send = vi.fn(async () => "ok" as const);
    await fanWebPush({
      frame: { kind: "cmds" },
      title: "Kit",
      stored: [row("ada", 1)],
      send,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("round-trip test push", () => {
  it("pushes a test card to every row and counts what the push service said", async () => {
    const ada1 = row("ada", 1);
    const ada2 = row("ada", 2);
    const ada3 = row("ada", 3);
    const send = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("-2")) {
        return { result: PushSend.Gone, status: 410 };
      }
      if (sub.endpoint.endsWith("-3")) {
        return { result: PushSend.Fail, status: 403 };
      }
      return { result: PushSend.Ok, status: 201 };
    });
    const { counts, gone } = await testWebPush({ title: "kit", stored: [ada1, ada2, ada3], send });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith(ada1.subscription, {
      title: "Kit",
      body: "Lock-screen push is on.",
      test: true,
    });
    expect(counts).toEqual({ rows: 3, ok: 1, gone: 1, fail: 1, statuses: [403] });
    expect(gone).toEqual([ada2]);
  });

  it("reports an empty room honestly", async () => {
    const send = vi.fn(async () => ({ result: PushSend.Ok }));
    const { counts, gone } = await testWebPush({ title: "kit", stored: [], send });
    expect(send).not.toHaveBeenCalled();
    expect(counts).toEqual({ rows: 0, ok: 0, gone: 0, fail: 0, statuses: [] });
    expect(gone).toEqual([]);
  });
});

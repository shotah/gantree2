import { beforeAll, describe, expect, it } from "vitest";
import { handlePush } from "@/app/lib/pushHttp";
import type { RoomEnv } from "@/lib/avatar/http";
import { encodeBase64Url, generateVapidKeys } from "@/lib/chat/push/vapid";
import { memoryStore } from "@/lib/door/users";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const SUB = "118212345678901234567";

const vapid = {
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "mailto:ada@example.com",
};

function b64(bytes: Uint8Array): string {
  return encodeBase64Url(bytes);
}

async function cookie(): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), { sub: SUB, email: "ada@example.com" });
  return `${SESSION_COOKIE}=${token}`;
}

function room(handler: (req: Request) => Promise<Response> | Response): RoomEnv & typeof vapid {
  return {
    SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GANTREE_ADMINS: "ada@example.com",
    ...vapid,
    AGENT: {
      idFromName: () => "id",
      get: () => ({ fetch: (req: Request) => Promise.resolve(handler(req)) }),
    },
  } as unknown as RoomEnv & typeof vapid;
}

const pub = new Uint8Array(65);
pub[0] = 0x04;
const auth = new Uint8Array(16).fill(7);
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: b64(pub), auth: b64(auth) },
};

beforeAll(async () => {
  const keys = await generateVapidKeys();
  vapid.VAPID_PUBLIC_KEY = keys.publicKey;
  vapid.VAPID_PRIVATE_KEY = JSON.stringify(keys.privateJwk);
});

describe("handlePush", () => {
  it("is 404 without VAPID keys", async () => {
    const res = await handlePush(new Request("https://chat.test/api/chat/push"), {
      SESSION_SECRET: SECRET,
      GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    }, memoryStore());
    expect(res.status).toBe(404);
  });

  it("returns the public key to a signed-in person", async () => {
    const res = await handlePush(new Request("https://chat.test/api/chat/push", {
      headers: { cookie: await cookie() },
    }), room(() => new Response(null)), memoryStore());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: vapid.VAPID_PUBLIC_KEY });
  });

  it("forwards a subscription with the door sub", async () => {
    let forwarded = "";
    let sub = "";
    const env = room(async (req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: SUB, role: "owner" }] });
      }
      sub = req.headers.get("X-Chat-Sub") ?? "";
      forwarded = await req.text();
      return Response.json({ ok: true });
    });
    const res = await handlePush(new Request("https://chat.test/api/chat/push", {
      method: "PUT",
      headers: { cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "kit", subscription }),
    }), env, memoryStore());
    expect(res.status).toBe(200);
    expect(sub).toBe(SUB);
    expect(JSON.parse(forwarded)).toMatchObject({ slug: "kit" });
  });
});

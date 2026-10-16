import { describe, expect, it } from "vitest";
import { handleTheme } from "@/app/lib/themeHttp";
import type { RoomEnv } from "@/lib/avatar/http";
import { memoryStore } from "@/lib/door/users";
import { settingsInventory } from "../../chat/settingsStub";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const SUB = "118212345678901234567";

async function cookie(): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), { sub: SUB, email: "ada@example.com" });
  return `${SESSION_COOKIE}=${token}`;
}

function room(handler: (req: Request) => Response): RoomEnv {
  return {
    SESSION_SECRET: SECRET,
    GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GANTREE_ADMINS: "ada@example.com",
    SETTINGS: settingsInventory(["kit"]),
    AGENT: {
      idFromName: () => "id",
      get: () => ({ fetch: (req: Request) => Promise.resolve(handler(req)) }),
    },
  } as unknown as RoomEnv;
}

describe("handleTheme", () => {
  it("writes a palette onto the room", async () => {
    let body = "";
    const env = room((req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: SUB, role: "owner" }] });
      }
      body = "sent";
      return Response.json({ theme: "boom" });
    });
    const res = await handleTheme(new Request("https://chat.test/api/chat/theme?slug=kit", {
      method: "POST",
      headers: { cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "boom" }),
    }), env, memoryStore([{
      entry: { sub: SUB, email: "ada@example.com" },
      role: "admin",
      agents: ["kit"],
      locked: false,
    }]));
    expect(res.status).toBe(200);
    expect(body).toBe("sent");
    expect(await res.json()).toEqual({ theme: "boom" });
  });

  it("lets the harness list and set the mood with the room bearer", async () => {
    const methods: string[] = [];
    const env = room((req) => {
      if (req.headers.get("X-Chat-Op") === "bearer") {
        return Response.json({ bearer: "crane-tok" });
      }
      methods.push(req.method);
      return Response.json({ theme: "boom", themes: [{ id: "boom" }] });
    });
    const list = await handleTheme(new Request("https://chat.test/api/chat/theme?slug=kit", {
      headers: { Authorization: "Bearer crane-tok" },
    }), env, memoryStore());
    expect(list.status).toBe(200);
    const set = await handleTheme(new Request("https://chat.test/api/chat/theme?slug=kit", {
      method: "POST",
      headers: { Authorization: "Bearer crane-tok", "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "boom" }),
    }), env, memoryStore());
    expect(set.status).toBe(200);
    expect(methods).toEqual(["GET", "PUT"]);
    const bad = await handleTheme(new Request("https://chat.test/api/chat/theme?slug=kit", {
      headers: { Authorization: "Bearer stale" },
    }), env, memoryStore());
    expect(bad.status).toBe(401);
  });

  it("rejects an unknown palette", async () => {
    const env = room((req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: SUB, role: "owner" }] });
      }
      return new Response(null, { status: 500 });
    });
    const res = await handleTheme(new Request("https://chat.test/api/chat/theme?slug=kit", {
      method: "POST",
      headers: { cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "nope" }),
    }), env, memoryStore([{
      entry: { sub: SUB, email: "ada@example.com" },
      role: "admin",
      agents: ["kit"],
      locked: false,
    }]));
    expect(res.status).toBe(400);
  });
});

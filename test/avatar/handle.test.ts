import { describe, expect, it } from "vitest";
import { handleAvatar, type RoomEnv } from "@/lib/avatar/http";
import { handleBackdrop } from "@/lib/backdrop/http";
import { memoryStore, type UserStore } from "@/lib/door/users";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const SUB = "118212345678901234567";

const base = {
  SESSION_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  GANTREE_ADMINS: "ada@example.com",
};

async function cookie(): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), { sub: SUB, email: "ada@example.com" });
  return `${SESSION_COOKIE}=${token}`;
}

function room(handler: (req: Request) => Promise<Response> | Response): RoomEnv {
  return {
    ...base,
    AGENT: {
      idFromName: () => "id",
      get: () => ({ fetch: (req: Request) => Promise.resolve(handler(req)) }),
    },
  } as unknown as RoomEnv;
}

const store: UserStore = memoryStore();

describe("handleAvatar", () => {
  it("rejects a missing session", async () => {
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit"), room(() => new Response(null)), store);
    expect(res.status).toBe(401);
  });

  it("rejects a bad slug before identity", async () => {
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=1bad", {
      headers: { cookie: await cookie() },
    }), room(() => new Response(null)), store);
    expect(res.status).toBe(400);
  });

  it("is 503 until the Agent binding exists", async () => {
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      headers: { cookie: await cookie() },
    }), base, store);
    expect(res.status).toBe(503);
  });

  it("forwards a face GET when the room lists the person", async () => {
    const env = room((req) => {
      const op = req.headers.get("X-Chat-Op");
      if (op === "allow") {
        return Response.json({ users: [{ sub: SUB, email: "ada@example.com", role: "owner" }] });
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { "Content-Type": "image/jpeg", "X-Chat-Rev": "3", ETag: "W/\"3\"" },
      });
    });
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      headers: { cookie: await cookie() },
    }), env, store);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Chat-Rev")).toBe("3");
  });

  it("forbids a room that does not list the person", async () => {
    const env = {
      ...room((req) => {
        if (req.headers.get("X-Chat-Op") === "allow") {
          return Response.json({ users: [{ sub: "someone-else", email: "nope@example.com", role: "owner" }] });
        }
        return new Response(null, { status: 500 });
      }),
      GANTREE_ADMINS: "other@example.com",
    } as RoomEnv;
    const member = memoryStore([{
      entry: { sub: SUB, email: "ada@example.com" },
      role: "member",
      agents: [],
      locked: false,
    }]);
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      headers: { cookie: await cookie() },
    }), env, member);
    expect(res.status).toBe(403);
  });

  it("admits a deployment admin when the room lists someone else", async () => {
    const env = room((req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: "someone-else", email: "nope@example.com", role: "owner" }] });
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { "Content-Type": "image/jpeg", "X-Chat-Rev": "7" },
      });
    });
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      headers: { cookie: await cookie() },
    }), env, store);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Chat-Rev")).toBe("7");
  });

  it("admits the harness with the bearer stored on the room, header only", async () => {
    const ops: string[] = [];
    const env = room((req) => {
      const op = req.headers.get("X-Chat-Op") ?? "";
      ops.push(op);
      if (op === "bearer") {
        return Response.json({ bearer: "from-do" });
      }
      if (op === "allow") {
        return Response.json({ users: [] });
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg", "X-Chat-Rev": "5" } });
    });
    const ok = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      headers: { Authorization: "Bearer from-do" },
    }), env, store);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-Chat-Rev")).toBe("5");
    expect(ops).not.toContain("allow");

    const wrong = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      headers: { Authorization: "Bearer nope" },
    }), env, store);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "unauthorized" });

    const query = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit&bearer=from-do"), env, store);
    expect(query.status).toBe(401);
  });

  it("admits the harness from the AGENT_BEARERS map without waking the bearer row", async () => {
    const ops: string[] = [];
    const base = room((req) => {
      ops.push(req.headers.get("X-Chat-Op") ?? "");
      return Response.json({ rev: 9 });
    });
    const env = { ...base, AGENT_BEARERS: "kit:crane-tok,ada:other" } as RoomEnv;
    const bytes = new Uint8Array(64);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      method: "POST",
      headers: { Authorization: "Bearer crane-tok", "Content-Type": "image/jpeg" },
      body: bytes,
    }), env, store);
    expect(res.status).toBe(200);
    expect(ops).toEqual(["avatar"]);
    const other = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=ada", {
      headers: { Authorization: "Bearer crane-tok" },
    }), env, store);
    expect(other.status).toBe(401);
  });

  it("puts a JPEG on the room", async () => {
    let method = "";
    const env = room((req) => {
      const op = req.headers.get("X-Chat-Op");
      if (op === "allow") {
        return Response.json({ users: [{ sub: SUB, role: "owner" }] });
      }
      method = req.method;
      return Response.json({ rev: 4 });
    });
    const bytes = new Uint8Array(64);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "image/jpeg" }), "face.jpg");
    const res = await handleAvatar(new Request("https://chat.test/api/chat/avatar?slug=kit", {
      method: "POST",
      headers: { cookie: await cookie() },
      body: form,
    }), env, store);
    expect(res.status).toBe(200);
    expect(method).toBe("PUT");
  });
});

describe("handleBackdrop", () => {
  it("deletes the room backdrop", async () => {
    let method = "";
    const env = room((req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: SUB, role: "owner" }] });
      }
      method = req.method;
      return new Response(null, { status: 204 });
    });
    const res = await handleBackdrop(new Request("https://chat.test/api/chat/backdrop?slug=kit", {
      method: "DELETE",
      headers: { cookie: await cookie() },
    }), env, store);
    expect(res.status).toBe(204);
    expect(method).toBe("DELETE");
  });
});

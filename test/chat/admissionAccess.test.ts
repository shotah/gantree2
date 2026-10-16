import { describe, expect, it, vi } from "vitest";
import { me } from "@/lib/door/http";
import { memoryStore } from "@/lib/door/users";
import { roomsFor } from "@/lib/chat/membership";
import { routeAgentSocket } from "@/lib/chat/route";
import { authorizeSlug } from "@/lib/chat/slugRoute";
import { sealSession, sessionKey, SESSION_COOKIE } from "@/lib/door/session";
import { settingsInventory } from "./settingsStub";

const SECRET = "s".repeat(32);
const OP = "118200000000000000002";
const MEM = "118200000000000000003";

describe("assignment and inventory", () => {
  it("does not list every household agent for a GANTREE_ALLOW member on /api/auth/me", async () => {
    const env = {
      SESSION_SECRET: SECRET,
      GANTREE_ADMINS: "admin@example.com",
      GANTREE_ALLOW: "member@example.com",
      SETTINGS: settingsInventory(["kit", "ada"]),
      DIRECTORY: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
    };
    const token = await sealSession(await sessionKey(SECRET), { sub: MEM, email: "member@example.com" });
    const req = new Request("https://g.test/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const res = await me(req, env, memoryStore(), roomsFor(env));
    expect(res.status).toBe(200);
    const body: { agents: string[] } = await res.json();
    expect(body.agents).toEqual([]);
  });

  it("lets an operator socket a slug that lists them and forbids one that does not", async () => {
    let named = "";
    const idFromName = vi.fn((name: string) => {
      named = name;
      return { name } as unknown as DurableObjectId;
    });
    const stub = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const req = input instanceof Request ? input : new Request(input);
        if (req.headers.get("X-Chat-Op") === "allow") {
          const users = named === "kit" ? [{ email: "op@example.com" }] : [];
          return Response.json({ users });
        }
        return new Response(null, { status: 200 });
      }),
    };
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      AGENT: { idFromName, get: () => stub } as unknown as DurableObjectNamespace,
      SETTINGS: settingsInventory(["kit", "ada"]),
    };
    const store = memoryStore([{
      entry: { sub: OP, email: "op@example.com" },
      role: "operator",
      agents: ["kit"],
      locked: false,
    }]);
    const token = await sealSession(await sessionKey(SECRET), { sub: OP, email: "op@example.com" });
    const ok = await routeAgentSocket(new Request("https://g.test/ws/kit?role=phone", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), env, "kit", store);
    expect(ok?.status).toBe(200);
    const namedBefore = idFromName.mock.calls.length;
    const no = await routeAgentSocket(new Request("https://g.test/ws/ada?role=phone", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), env, "ada", store);
    expect(no?.status).toBe(403);
    expect(idFromName.mock.calls.length).toBeGreaterThan(namedBefore);
  });
});

function fakeAgentForMember(users: unknown[] = []) {
  const idFromName = vi.fn((name: string) => name);
  const stub = {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(input);
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users });
      }
      return new Response(null, { status: 404 });
    }),
  };
  const AGENT = {
    idFromName,
    get: () => stub,
  } as unknown as DurableObjectNamespace;
  return { AGENT, idFromName };
}

describe("email-only env admin on Who can chat", () => {
  const SUB = "118212345678901234567";
  const EMAIL = "ada@example.com";

  function kitBinding(users: { sub?: string; email?: string }[]) {
    const idFromName = vi.fn((name: string) => ({ name }) as unknown as DurableObjectId);
    const stub = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const req = input instanceof Request ? input : new Request(input);
        if (req.headers.get("X-Chat-Op") === "allow") {
          return Response.json({ users });
        }
        return new Response(null, { status: 200 });
      }),
    };
    return {
      idFromName,
      stub,
      AGENT: { idFromName, get: () => stub } as unknown as DurableObjectNamespace,
    };
  }

  it("opens the socket and lists kit when the allow row is email-only", async () => {
    const { AGENT, stub } = kitBinding([{ email: EMAIL }]);
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      GANTREE_ADMINS: EMAIL,
      AGENT,
      SETTINGS: settingsInventory(["kit"]),
      DIRECTORY: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
    };
    const token = await sealSession(await sessionKey(SECRET), { sub: SUB, email: EMAIL });
    const headers = { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };
    const socket = await routeAgentSocket(new Request("https://g.test/ws/kit?role=phone", { headers }), env, "kit", memoryStore());
    expect(socket?.status).toBe(200);
    const upgrade = stub.fetch.mock.calls.map((call) => call[0]).find((input) => {
      const req = input instanceof Request ? input : new Request(input);
      return req.headers.get("Upgrade") === "websocket" || req.headers.get("X-Chat-Role") === "phone";
    });
    const stamped = upgrade instanceof Request ? upgrade : new Request(upgrade ?? "https://g.test/");
    expect(stamped.headers.get("X-Chat-Sub")).toBe(SUB);
    expect(stamped.headers.get("X-Chat-Email")).toBe(EMAIL);
    expect(stamped.headers.get("X-Chat-EmailVerified")).toBe("1");
    expect(stamped.headers.get("X-Chat-Door-Role")).toBe("admin");

    const meRes = await me(new Request("https://g.test/api/auth/me", { headers }), env, memoryStore(), roomsFor(env));
    expect(meRes.status).toBe(200);
    const body: { agents: string[] } = await meRes.json();
    expect(body.agents).toEqual(["kit"]);
  });
});

describe("member room list when DIRECTORY is unset", () => {
  it("allows authorizeSlug when the room lists the member and may call agentStub", async () => {
    const token = await sealSession(await sessionKey(SECRET), { sub: MEM, email: "member@example.com" });
    const { AGENT, idFromName } = fakeAgentForMember([{ sub: MEM, email: "member@example.com" }]);
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      GANTREE_ALLOW: "member@example.com",
      AGENT,
      SETTINGS: settingsInventory(["kit"]),
    };
    const res = await authorizeSlug(env, new Request("https://g.test/api/theme?slug=kit", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), "kit", memoryStore());
    expect(res).toBeNull();
    expect(idFromName).toHaveBeenCalled();
  });

  it("403s when the room does not list the member", async () => {
    const token = await sealSession(await sessionKey(SECRET), { sub: MEM, email: "member@example.com" });
    const { AGENT, idFromName } = fakeAgentForMember([]);
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      GANTREE_ALLOW: "member@example.com",
      AGENT,
      SETTINGS: settingsInventory(["kit"]),
    };
    const res = await authorizeSlug(env, new Request("https://g.test/api/theme?slug=kit", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), "kit", memoryStore());
    expect(res?.status).toBe(403);
    expect(idFromName).toHaveBeenCalled();
  });

  it("404s an unknown inventory slug without idFromName", async () => {
    const token = await sealSession(await sessionKey(SECRET), { sub: MEM, email: "member@example.com" });
    const { AGENT, idFromName } = fakeAgentForMember([{ sub: MEM }]);
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      GANTREE_ALLOW: "member@example.com",
      AGENT,
      SETTINGS: settingsInventory(["ada"]),
    };
    const res = await authorizeSlug(env, new Request("https://g.test/api/theme?slug=kit", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), "kit", memoryStore());
    expect(res?.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
  });
});

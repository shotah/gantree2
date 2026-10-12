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

  it("lets an operator socket an assigned slug and forbids another without idFromName", async () => {
    const idFromName = vi.fn((name: string) => ({ name }) as unknown as DurableObjectId);
    const stub = { fetch: vi.fn(async () => new Response(null, { status: 200 })) };
    const env = {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      AGENT: { idFromName, get: () => stub },
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
    expect(idFromName.mock.calls.length).toBe(namedBefore);
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

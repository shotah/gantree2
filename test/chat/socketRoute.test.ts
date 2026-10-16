import { describe, expect, it, vi } from "vitest";
import { sealSession, sessionKey, SESSION_COOKIE } from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";
import type { AgentEnv } from "@/lib/chat/env";
import { routeAgentSocket } from "@/lib/chat/route";
import { settingsInventory } from "./settingsStub";

const SECRET = "s".repeat(32);
const ADA = "118212345678901234567";

function binding(fetchImpl: (req: Request) => Promise<Response>, env: Partial<AgentEnv> = {}, slugs = ["kit"]) {
  const idFromName = vi.fn((name: string) => ({ name }) as unknown as DurableObjectId);
  const stub = { fetch: vi.fn(async (input: RequestInfo | URL) => fetchImpl(input instanceof Request ? input : new Request(input))) };
  const AGENT = {
    idFromName,
    get: () => stub,
  } as unknown as DurableObjectNamespace;
  return {
    stub,
    idFromName,
    env: { AGENT, SETTINGS: settingsInventory(slugs), ...env } as AgentEnv,
  };
}

describe("routeAgentSocket", () => {
  it("returns null when the path has no slug", async () => {
    expect(await routeAgentSocket(new Request("https://x.test/ws"), {}, null)).toBeNull();
  });

  it("404s a missing role and 403s a foreign Origin", async () => {
    const { stub, env, idFromName } = binding(async () => new Response(null, { status: 200 }), { CHAT_SECRET: "shared" });
    const missing = await routeAgentSocket(new Request("http://127.0.0.1/ws/kit"), env, "kit");
    expect(missing?.status).toBe(404);
    const foreign = await routeAgentSocket(new Request("http://127.0.0.1/ws/kit?role=phone", {
      headers: { Origin: "https://evil.example" },
    }), env, "kit");
    expect(foreign?.status).toBe(403);
    expect(stub.fetch).not.toHaveBeenCalled();
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("503s when nothing is configured", async () => {
    const res = await routeAgentSocket(new Request("https://x.test/ws/kit?role=phone"), {}, "kit");
    expect(res?.status).toBe(503);
    expect(await res?.json()).toEqual({ error: "config" });
  });

  it("refuses the spike secret off loopback", async () => {
    const res = await routeAgentSocket(
      new Request("https://gantree.example/ws/kit?role=phone", { headers: { Authorization: "Bearer shared" } }),
      { CHAT_SECRET: "shared" },
      "kit",
    );
    expect(res?.status).toBe(503);
  });

  it("404s a spike secret for a slug not in inventory without idFromName", async () => {
    const { stub, env, idFromName } = binding(async () => new Response(null, { status: 200 }), { CHAT_SECRET: "shared" }, ["kit"]);
    const res = await routeAgentSocket(new Request("http://127.0.0.1/ws/unknown?role=phone&secret=shared"), env, "unknown");
    expect(res?.status).toBe(404);
    expect(stub.fetch).not.toHaveBeenCalled();
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("stamps a spike phone and forwards the upgrade", async () => {
    const { stub, env } = binding(async (req) => {
      expect(req.headers.get("X-Chat-Role")).toBe("phone");
      expect(req.headers.get("X-Chat-Sub")).toBe("spike");
      expect(req.headers.get("X-Chat-Rate")).toBe("spike:phone");
      expect(req.headers.get("Authorization")).toBeNull();
      return new Response(null, { status: 200 });
    }, { CHAT_SECRET: "shared" });
    const res = await routeAgentSocket(new Request("http://127.0.0.1/ws/kit?role=phone&secret=shared"), env, "kit");
    expect(res?.status).toBe(200);
    expect(stub.fetch).toHaveBeenCalledOnce();
  });

  it("404s when the spike is good but the binding is missing", async () => {
    const res = await routeAgentSocket(
      new Request("http://127.0.0.1/ws/kit?role=crane", { headers: { Authorization: "Bearer shared" } }),
      { CHAT_SECRET: "shared" },
      "kit",
    );
    expect(res?.status).toBe(404);
  });

  it("admits a session cookie that is on the room list", async () => {
    const token = await sealSession(await sessionKey(SECRET), { sub: ADA, email: "ada@example.com" });
    const { env } = binding(async (req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: ADA }] });
      }
      expect(req.headers.get("X-Chat-Role")).toBe("phone");
      expect(req.headers.get("X-Chat-Sub")).toBe(ADA);
      expect(req.headers.get("X-Chat-Email")).toBe("ada@example.com");
      expect(req.headers.get("X-Chat-EmailVerified")).toBe("1");
      expect(req.headers.get("X-Chat-Slug")).toBe("kit");
      return new Response(null, { status: 200 });
    }, { GOOGLE_CLIENT_ID: "id", SESSION_SECRET: SECRET, GANTREE_ADMINS: `${ADA}:ada@example.com` });
    const store = memoryStore([{
      entry: { sub: ADA, email: "ada@example.com" },
      role: "admin",
      agents: ["kit"],
      locked: false,
    }]);
    const res = await routeAgentSocket(new Request("https://gantree.example/ws/kit?role=phone", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), env, "kit", store);
    expect(res?.status).toBe(200);
  });

  it("403s a session that is not on the room list", async () => {
    const token = await sealSession(await sessionKey(SECRET), { sub: ADA, email: null });
    const { stub, env, idFromName } = binding(async () => Response.json({ users: [] }), {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
    });
    const res = await routeAgentSocket(new Request("https://gantree.example/ws/kit?role=phone", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), env, "kit");
    expect(res?.status).toBe(403);
    expect(stub.fetch).not.toHaveBeenCalled();
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("admits the harness from the env map and from the DO row", async () => {
    const fromEnv = binding(async (req) => {
      expect(req.headers.get("X-Chat-Role")).toBe("crane");
      expect(req.headers.get("X-Chat-Rate")).toBe("bearer:kit");
      expect(req.headers.get("X-Chat-Op")).toBeNull();
      return new Response(null, { status: 200 });
    }, { GOOGLE_CLIENT_ID: "id", SESSION_SECRET: SECRET, AGENT_BEARERS: "kit:crane-tok" });
    const header = await routeAgentSocket(new Request("https://gantree.example/ws/kit?role=crane", {
      headers: { Authorization: "Bearer crane-tok" },
    }), fromEnv.env, "kit");
    expect(header?.status).toBe(200);

    const fromDo = binding(async (req) => {
      if (req.headers.get("X-Chat-Op") === "bearer") {
        return Response.json({ bearer: "from-do" });
      }
      expect(req.headers.get("X-Chat-Role")).toBe("crane");
      return new Response(null, { status: 200 });
    }, { GOOGLE_CLIENT_ID: "id", SESSION_SECRET: SECRET });
    const row = await routeAgentSocket(new Request("https://gantree.example/ws/kit?role=agent", {
      headers: { Authorization: "Bearer from-do" },
    }), fromDo.env, "kit");
    expect(row?.status).toBe(200);

    const query = await routeAgentSocket(
      new Request("https://gantree.example/ws/kit?role=crane&bearer=crane-tok"),
      fromEnv.env,
      "kit",
    );
    expect(query?.status).toBe(401);
  });

  it("admits the loopback dev user when they are an admin", async () => {
    const { env } = binding(async (req) => {
      expect(req.headers.get("X-Chat-Sub")).toBe(ADA);
      expect(req.headers.get("X-Chat-Rate")).toBe(`sub:${ADA}`);
      return new Response(null, { status: 200 });
    }, {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      GANTREE_DEV_USER: `${ADA}:ada@example.com`,
      GANTREE_ADMINS: `${ADA}:ada@example.com`,
    });
    const store = memoryStore([{
      entry: { sub: ADA, email: "ada@example.com" },
      role: "admin",
      agents: ["kit"],
      locked: false,
    }]);
    const res = await routeAgentSocket(new Request("http://127.0.0.1/ws/kit?role=phone"), env, "kit", store);
    expect(res?.status).toBe(200);
    const remote = await routeAgentSocket(new Request("https://gantree.example/ws/kit?role=phone"), env, "kit", store);
    expect(remote?.status).toBe(401);
  });

  it("refuses the dev user when they are not assigned", async () => {
    const { env } = binding(async () => new Response(null, { status: 200 }), {
      GOOGLE_CLIENT_ID: "id",
      SESSION_SECRET: SECRET,
      GANTREE_DEV_USER: `${ADA}:ada@example.com`,
      GANTREE_ALLOW: `${ADA}:ada@example.com`,
    });
    const res = await routeAgentSocket(new Request("http://127.0.0.1/ws/kit?role=phone"), env, "kit");
    expect(res?.status).toBe(403);
  });
});

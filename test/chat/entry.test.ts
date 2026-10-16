import { describe, expect, it, vi } from "vitest";
import { isSocketPath, withAgentSockets } from "@/lib/chat/entry";
import type { AgentEnv } from "@/lib/chat/env";
import { memoryStore } from "@/lib/door/users";
import { sealSession, sessionKey, SESSION_COOKIE } from "@/lib/door/session";
import { settingsInventory } from "./settingsStub";

const ctx = {} as ExecutionContext;
const SECRET = "s".repeat(32);
const OP = "118200000000000000002";
/** The entry sees wrangler's incoming request type; a plain Request is the same object at runtime. */
const req = (url: string) => new Request(url) as Request<unknown, IncomingRequestCfProperties>;

function operatorSocketEnv() {
  let named = "";
  const idFromName = vi.fn((name: string) => {
    named = name;
    return { name } as unknown as DurableObjectId;
  });
  const stub = {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const inner = input instanceof Request ? input : new Request(input);
      if (inner.headers.get("X-Chat-Op") === "allow") {
        const users = named === "kit" ? [{ email: "op@example.com" }] : [];
        return Response.json({ users });
      }
      return new Response(null, { status: 200 });
    }),
  };
  return {
    GOOGLE_CLIENT_ID: "id",
    SESSION_SECRET: SECRET,
    GANTREE_ADMINS: "admin@example.com",
    AGENT: { idFromName, get: () => stub } as unknown as DurableObjectNamespace,
    SETTINGS: settingsInventory(["kit"]),
  } satisfies Partial<AgentEnv> as AgentEnv;
}

describe("withAgentSockets", () => {
  it("knows the socket prefix", () => {
    expect(isSocketPath("/ws/kit")).toBe(true);
    expect(isSocketPath("/ws/")).toBe(true);
    expect(isSocketPath("/api/ws/kit")).toBe(false);
    expect(isSocketPath("/chat/kit")).toBe(false);
  });

  it("falls through to the app for everything else", async () => {
    const next = vi.fn(async () => new Response("app"));
    const fetch = withAgentSockets<AgentEnv>(next);
    const res = await fetch(req("https://g.test/chat/kit"), {}, ctx);
    expect(await res.text()).toBe("app");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("answers /ws/<slug> itself and never calls the app", async () => {
    const next = vi.fn(async () => new Response("app"));
    const fetch = withAgentSockets<AgentEnv>(next);
    // No role → the router's 404, proving the request went to the room path.
    const res = await fetch(req("https://g.test/ws/kit"), {}, ctx);
    expect(res.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("404s a bare /ws/ with no slug", async () => {
    const next = vi.fn(async () => new Response("app"));
    const res = await withAgentSockets<AgentEnv>(next)(req("https://g.test/ws/?role=phone"), {}, ctx);
    expect(res.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes the store factory into the socket door", async () => {
    const env = operatorSocketEnv();
    const token = await sealSession(await sessionKey(SECRET), { sub: OP, email: "op@example.com" });
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    const socketReq = new Request("https://g.test/ws/kit?role=phone", {
      headers: { Cookie: cookie },
    }) as Request<unknown, IncomingRequestCfProperties>;
    const next = vi.fn(async () => new Response("app"));
    const denied = await withAgentSockets<AgentEnv>(next)(socketReq, env, ctx);
    expect(denied.status).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const nextWithStore = vi.fn(async () => new Response("app"));
    const allowedRes = await withAgentSockets<AgentEnv>(nextWithStore, () => memoryStore([{
      entry: { sub: OP, email: "op@example.com" },
      role: "operator",
      agents: ["kit"],
      locked: false,
    }]))(socketReq, env, ctx);
    expect(allowedRes.status).toBe(200);
    expect(nextWithStore).not.toHaveBeenCalled();
  });
});

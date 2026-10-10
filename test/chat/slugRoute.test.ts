import { describe, expect, it, vi } from "vitest";
import { sealSession, sessionKey, SESSION_COOKIE } from "@/lib/door/session";
import type { AgentEnv } from "@/lib/chat/env";
import { authorizeSlug, fromStub, withSlug } from "@/lib/chat/slugRoute";

const SECRET = "s".repeat(32);
const ADA = "118212345678901234567";

function fakeAgent(users: unknown[] = [], bearer: string | null = null) {
  const stub = {
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(input);
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users });
      }
      if (req.headers.get("X-Chat-Op") === "bearer") {
        return Response.json({ bearer });
      }
      return new Response("blob", { status: 200, headers: { "X-Chat-Rev": "7" } });
    }),
  };
  const AGENT = {
    idFromName: (name: string) => name,
    get: () => stub,
  } as unknown as DurableObjectNamespace;
  return { stub, AGENT };
}

describe("withSlug", () => {
  it("refuses a bad slug before touching auth", async () => {
    const { AGENT } = fakeAgent();
    const next = vi.fn();
    const res = await withSlug({ AGENT, CHAT_SECRET: "shared" }, new Request("http://127.0.0.1/api/backdrop?slug=1bad"), next);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad slug" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes the spike secret through to the room stub", async () => {
    const { AGENT, stub } = fakeAgent();
    const next = vi.fn(async (slug: string, s: DurableObjectStub) => {
      expect(slug).toBe("kit");
      expect(s).toBe(stub);
      return new Response("ok");
    });
    const res = await withSlug(
      { AGENT, CHAT_SECRET: "shared" },
      new Request("http://127.0.0.1/api/backdrop?slug=kit&secret=shared"),
      next,
    );
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies a wrong spike secret with the shared 401 body", async () => {
    const { AGENT } = fakeAgent();
    const next = vi.fn();
    const res = await withSlug({ AGENT, CHAT_SECRET: "shared" }, new Request("http://127.0.0.1/api/backdrop?slug=kit&secret=nope"), next);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("lets the harness bearer in on the Authorization header only", async () => {
    const { AGENT } = fakeAgent();
    const env: AgentEnv = {
      AGENT,
      GOOGLE_CLIENT_ID: "g",
      SESSION_SECRET: SECRET,
      AGENT_BEARERS: "kit:crane-tok",
    };
    const next = vi.fn(async () => new Response("ok"));
    const header = await withSlug(env, new Request("https://gantree.example/api/backdrop?slug=kit", {
      headers: { Authorization: "Bearer crane-tok" },
    }), next);
    expect(header.status).toBe(200);
    const other = await withSlug(env, new Request("https://gantree.example/api/backdrop?slug=ada", {
      headers: { Authorization: "Bearer crane-tok" },
    }), next);
    expect(other.status).toBe(401);
    const query = await withSlug(env, new Request("https://gantree.example/api/backdrop?slug=kit&bearer=crane-tok"), next);
    expect(query.status).toBe(401);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("lets the bearer stored on the room in", async () => {
    const { AGENT } = fakeAgent([], "from-do");
    const next = vi.fn(async () => new Response("ok"));
    const res = await withSlug({
      AGENT,
      GOOGLE_CLIENT_ID: "g",
      SESSION_SECRET: SECRET,
    }, new Request("https://gantree.example/api/avatar?slug=kit", {
      headers: { Authorization: "Bearer from-do" },
    }), next);
    expect(res.status).toBe(200);
  });

  it("admits a phone cookie on the room list and forbids a stranger", async () => {
    const token = await sealSession(await sessionKey(SECRET), { sub: ADA, email: "ada@example.com" });
    const { AGENT } = fakeAgent([{ sub: ADA }]);
    const env: AgentEnv = { AGENT, GOOGLE_CLIENT_ID: "g", SESSION_SECRET: SECRET };
    const next = vi.fn(async () => new Response("ok"));
    const ok = await withSlug(env, new Request("https://gantree.example/api/theme?slug=kit", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    }), next);
    expect(ok.status).toBe(200);
    const stranger = await sealSession(await sessionKey(SECRET), { sub: "9999999999", email: null });
    const no = await withSlug(env, new Request("https://gantree.example/api/theme?slug=kit", {
      headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(stranger)}` },
    }), next);
    expect(no.status).toBe(403);
    expect(await no.json()).toEqual({ error: "unauthorized" });
  });

  it("is a config error when the binding is missing", async () => {
    const next = vi.fn();
    const res = await withSlug({ CHAT_SECRET: "shared" }, new Request("http://127.0.0.1/api/backdrop?slug=kit&secret=shared"), next);
    expect(res.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("authorizeSlug", () => {
  it("skips auth for the loopback dev user only", async () => {
    const { AGENT } = fakeAgent();
    const env: AgentEnv = { AGENT, GANTREE_DEV_USER: `${ADA}:ada@example.com` };
    expect(await authorizeSlug(env, new Request("http://127.0.0.1:3000/api/backdrop?slug=kit"), "kit")).toBeNull();
    const remote = await authorizeSlug(env, new Request("https://gantree.example/api/backdrop?slug=kit"), "kit");
    expect(remote?.status).toBe(503);
  });
});

describe("fromStub", () => {
  it("copies status, headers, and body off the Durable Object response", async () => {
    const res = await fromStub(new Response("jpeg", { status: 200, headers: { "X-Chat-Rev": "9", "Content-Type": "image/jpeg" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Chat-Rev")).toBe("9");
    expect(await res.text()).toBe("jpeg");
    const empty = await fromStub(new Response(null, { status: 404 }));
    expect(empty.status).toBe(404);
    expect(empty.body).toBeNull();
  });
});

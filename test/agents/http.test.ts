import { describe, expect, it } from "vitest";
import { openRegistry, type AgentCreateBody } from "@/lib/agents/registry";
import {
  deleteAgent,
  deleteAgentPersona,
  getAgent,
  getAgentBearer,
  getAgentConfig,
  getAgentPersona,
  getAgentSelf,
  getAgentLog,
  getAgents,
  getAgentStatus,
  postAgentRestart,
  getAgentUsers,
  getSamples,
  patchAgentConfig,
  putAgentPersona,
  putAgentSelf,
  startAgentAuth,
  postAgent,
  putAgentUsers,
  settingsApi,
  type AgentsHttpEnv,
} from "@/lib/agents/http";
import { emptyStatus } from "@/lib/agents/status";
import { openSettings, type SampleInput, type SampleQuery } from "@/lib/door/settingsStore";
import { memorySql } from "../door/memorySql";

const ADA = "118212345678901234567";

function usersFrom(body: string): unknown[] {
  if (!body) {
    return [];
  }
  const parsed = JSON.parse(body) as { users?: unknown };
  return Array.isArray(parsed.users) ? parsed.users : [];
}

function asRole(role: "admin" | "operator" | "member", path: string, agents: string[] = [], method = "GET", body?: string) {
  return new Request(`https://g.test${path}`, {
    method,
    headers: {
      "x-gantree-sub": ADA,
      "x-gantree-email": "ada@example.com",
      "x-gantree-role": role,
      "x-gantree-agents": agents.join(","),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

function world() {
  const sql = memorySql();
  const users = openSettings(sql, () => 50);
  const agents = openRegistry(sql, () => 50);
  const calls: { url: string; method: string; op: string | null; body: string }[] = [];
  let bearer: string | null = "room-secret";
  let down = false;
  const api = {
    listAgents: () => agents.list(),
    getAgent: (slug: string) => agents.get(slug),
    createAgent: (input: AgentCreateBody, actor: string) => agents.create(input, actor),
    deleteAgent: (slug: string, actor: string) => agents.remove(slug, actor),
    listSamples: (query?: SampleQuery) => users.listSamples(query),
    addSample: (input: SampleInput) => users.addSample(input),
  };
  const env = {
    SETTINGS: { getByName: () => api },
    AGENT: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        fetch: async (req: Request) => {
          if (down) {
            throw new Error("down");
          }
          const body = await req.clone().text();
          calls.push({ url: req.url, method: req.method, op: req.headers.get("X-Chat-Op"), body });
          const op = req.headers.get("X-Chat-Op");
          if (op === "bearer") {
            return Response.json({ bearer });
          }
          if (op === "status" || op === "restart") {
            return Response.json({ ...emptyStatus(), state: "ready", since: 50 });
          }
          if (op === "config") {
            return Response.json({ envKeys: ["A"], mcp: "toml", persona: "", updatedAt: 1, recreate: false });
          }
          if (op === "log") {
            return Response.json({ lines: [], next: 0 });
          }
          if (op === "allow") {
            return Response.json({ users: usersFrom(body) });
          }
          return Response.json({ ok: true });
        },
      }),
    },
  } as unknown as AgentsHttpEnv;
  return {
    env,
    api,
    calls,
    users,
    agents,
    setBearer: (value: string | null) => {
      bearer = value;
    },
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

describe("agents http", () => {
  it("lists every agent for an admin and only runnable ones for an operator", async () => {
    const { env, agents } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);
    const all = await getAgents(asRole("admin", "/api/agents"), env);
    expect(all.status).toBe(200);
    const body = await all.json<{ agents: { slug: string; canMutate: boolean; status: { state: string } }[] }>();
    expect(body.agents.map((row) => row.slug)).toEqual(["ada", "kit"]);
    expect(body.agents.every((row) => row.canMutate && row.status.state === "ready")).toBe(true);

    const mine = await getAgents(asRole("operator", "/api/agents", ["kit"]), env);
    expect((await mine.json<{ agents: { slug: string; canMutate: boolean }[] }>()).agents).toEqual([
      expect.objectContaining({ slug: "kit", canMutate: true }),
    ]);
    expect((await getAgents(asRole("member", "/api/agents"), env)).status).toBe(403);
    expect((await getAgents(new Request("https://g.test/api/agents"), env)).status).toBe(401);
  });

  it("mints a room bearer on create when the room has none, keeps an existing one", async () => {
    const { env, calls, setBearer } = world();
    setBearer(null);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "kit" })), env)).status).toBe(201);
    const minted = calls.filter((c) => c.op === "bearer" && c.method === "PUT");
    expect(minted).toHaveLength(1);
    const body = JSON.parse(minted[0]?.body ?? "{}") as { bearer?: string };
    expect(body.bearer).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    calls.length = 0;
    setBearer("room-secret");
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "ada" })), env)).status).toBe(201);
    expect(calls.filter((c) => c.op === "bearer" && c.method === "PUT")).toHaveLength(0);
  });

  it("creates for an admin, refuses an operator, and deletes the row", async () => {
    const { env, agents, users } = world();
    const created = await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "Kit", tags: ["house"] })), env);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ agent: { slug: "kit", name: "kit", tags: ["house"], canMutate: true } });
    expect((await postAgent(asRole("operator", "/api/agents", ["kit"], "POST", "{}"), env)).status).toBe(403);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", "{"), env)).status).toBe(400);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "kit" })), env)).status).toBe(409);

    await users.addSample({ agent: "kit", kind: "turn", value: 1 });
    const removed = await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "Kit");
    expect(removed.status).toBe(204);
    expect(await agents.get("kit")).toBeNull();
    expect(await users.listSamples({ agent: "kit" })).toHaveLength(1);
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "kit")).status).toBe(404);
    expect((await deleteAgent(asRole("operator", "/api/agents/kit", ["kit"], "DELETE"), env, "kit")).status).toBe(403);
  });

  it("hands the room bearer only to an admin on the loopback dev door", async () => {
    const { env } = world();
    const dev: AgentsHttpEnv = { ...env, GANTREE_DEV_USER: `${ADA}:ada@example.com` };
    const local = (role: "admin" | "operator", agents: string[] = []) => new Request("http://127.0.0.1:3000/api/agents/kit/bearer", {
      headers: asRole(role, "/x", agents).headers,
    });
    // No dev user, or not loopback: the route does not exist.
    expect((await getAgentBearer(asRole("admin", "/api/agents/kit/bearer"), env, "kit")).status).toBe(404);
    expect((await getAgentBearer(asRole("admin", "/api/agents/kit/bearer"), dev, "kit")).status).toBe(404);
    expect((await getAgentBearer(new Request("http://203.0.113.9:3000/api/agents/kit/bearer", { headers: asRole("admin", "/x").headers }), dev, "kit")).status).toBe(404);
    // Loopback dev: admin only, slug grammar, then the DO row.
    expect((await getAgentBearer(local("operator", ["kit"]), dev, "kit")).status).toBe(403);
    expect((await getAgentBearer(local("admin"), dev, "Bad_Slug")).status).toBe(400);
    const res = await getAgentBearer(local("admin"), dev, "kit");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bearer: "room-secret" });
    expect((await getAgentBearer(local("admin"), { ...dev, AGENT: undefined }, "kit")).status).toBe(503);
  });

  it("reads one card and proxies config, status, log, and users", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    expect((await getAgent(asRole("operator", "/api/agents/ada", ["kit"]), env, "ada")).status).toBe(403);
    expect((await getAgent(asRole("admin", "/api/agents/ada"), env, "ada")).status).toBe(404);
    expect((await getAgent(asRole("admin", "/api/agents/nope"), env, "Bad_Slug")).status).toBe(400);
    const card = await getAgent(asRole("operator", "/api/agents/kit", ["kit"]), env, "kit");
    expect((await card.json<{ agent: { slug: string } }>()).agent.slug).toBe("kit");

    expect((await getAgentConfig(asRole("operator", "/api/agents/kit/config", ["kit"]), env, "kit")).status).toBe(200);
    const patched = await patchAgentConfig(
      asRole("operator", "/api/agents/kit/config", ["kit"], "PATCH", JSON.stringify({ mcp: "toml" })),
      env,
      "kit",
    );
    expect(patched.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", op: "config", body: JSON.stringify({ mcp: "toml" }) });
    expect((await getAgentStatus(asRole("admin", "/api/agents/kit/status"), env, "kit")).status).toBe(200);
    const log = await getAgentLog(asRole("admin", "/api/agents/kit/log?after=5"), env, "kit");
    expect(log.status).toBe(200);
    expect(calls.at(-1)?.url).toContain("after=5");
    const users = await putAgentUsers(
      asRole("admin", "/api/agents/kit/users", [], "PUT", JSON.stringify({ users: [{ sub: ADA }] })),
      env,
      "kit",
    );
    expect(await users.json()).toEqual({ users: [{ sub: ADA }] });
    expect((await getAgentUsers(asRole("admin", "/api/agents/kit/users"), env, "kit")).status).toBe(200);
    expect((await getAgentUsers(asRole("operator", "/api/agents/ada/users", ["kit"]), env, "ada")).status).toBe(403);
  });

  it("gates self notes the way config is gated", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    expect((await getAgentSelf(new Request("https://g.test/api/agents/kit/self"), env, "kit")).status).toBe(401);
    expect((await getAgentSelf(asRole("member", "/api/agents/kit/self"), env, "kit")).status).toBe(403);
    expect((await getAgentSelf(asRole("operator", "/api/agents/ada/self", ["kit"]), env, "ada")).status).toBe(403);
    expect((await getAgentSelf(asRole("admin", "/api/agents/nope/self"), env, "Bad_Slug")).status).toBe(400);
    expect((await getAgentSelf(asRole("operator", "/api/agents/kit/self", ["kit"]), env, "kit")).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "GET", op: "self_get" });
    const put = await putAgentSelf(
      asRole("admin", "/api/agents/kit/self", [], "PUT", JSON.stringify({ text: "- dry" })),
      env,
      "kit",
    );
    expect(put.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "PUT", op: "self_put", body: JSON.stringify({ text: "- dry" }) });
  });

  it("gates auth start the way config is gated and skips garmin", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    const post = (role: "admin" | "operator" | "member", slug: string, agentsFor: string[], body: string) =>
      startAgentAuth(asRole(role, `/api/agents/${slug}/auth/start`, agentsFor, "POST", body), env, slug);
    expect((await startAgentAuth(new Request("https://g.test/api/agents/kit/auth/start", { method: "POST", body: "{}" }), env, "kit")).status).toBe(401);
    expect((await post("member", "kit", [], JSON.stringify({ plugin: "google" }))).status).toBe(403);
    expect((await post("operator", "ada", ["kit"], JSON.stringify({ plugin: "google" }))).status).toBe(403);
    expect((await startAgentAuth(asRole("admin", "/api/agents/nope/auth/start", [], "POST", JSON.stringify({ plugin: "google" })), env, "Bad_Slug")).status).toBe(400);
    const before = calls.length;
    expect((await post("admin", "kit", [], JSON.stringify({ plugin: "garmin" }))).status).toBe(400);
    expect((await post("admin", "kit", [], "not-json")).status).toBe(400);
    expect(calls.length).toBe(before);
    const ok = await post("operator", "kit", ["kit"], JSON.stringify({ plugin: "google" }));
    expect(ok.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      op: "auth_start",
      body: JSON.stringify({ plugin: "google", origin: "https://g.test", slug: "kit" }),
    });
  });

  it("gates persona files the way config is gated", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    expect((await getAgentPersona(new Request("https://g.test/api/agents/kit/persona"), env, "kit")).status).toBe(401);
    expect((await getAgentPersona(asRole("member", "/api/agents/kit/persona"), env, "kit")).status).toBe(403);
    expect((await getAgentPersona(asRole("operator", "/api/agents/ada/persona", ["kit"]), env, "ada")).status).toBe(403);
    expect((await getAgentPersona(asRole("admin", "/api/agents/nope/persona"), env, "Bad_Slug")).status).toBe(400);
    expect((await getAgentPersona(asRole("operator", "/api/agents/kit/persona", ["kit"]), env, "kit")).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "GET", op: "persona_get" });
    const put = await putAgentPersona(
      asRole("admin", "/api/agents/kit/persona", [], "PUT", JSON.stringify({ name: "PERSONA.md", text: "Be brief." })),
      env,
      "kit",
    );
    expect(put.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({
      method: "PUT",
      op: "persona_put",
      body: JSON.stringify({ name: "PERSONA.md", text: "Be brief." }),
    });
    const removed = await deleteAgentPersona(
      asRole("admin", "/api/agents/kit/persona", [], "DELETE", JSON.stringify({ name: "SOUL.md" })),
      env,
      "kit",
    );
    expect(removed.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", op: "persona_delete", body: JSON.stringify({ name: "SOUL.md" }) });
  });

  it("returns 503 when settings or the agent stub fails", async () => {
    const { env, setDown } = world();
    expect(settingsApi({ SETTINGS: {} } as AgentsHttpEnv)).toBeNull();
    expect((await getAgents(asRole("admin", "/api/agents"), { SETTINGS: {} } as AgentsHttpEnv)).status).toBe(503);
    setDown(true);
    const created = await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "kit" })), env);
    expect(created.status).toBe(201);
    expect((await created.json<{ agent: { status: null } }>()).agent.status).toBeNull();
    expect((await getAgentConfig(asRole("admin", "/api/agents/kit/config"), env, "kit")).status).toBe(503);
    const listed = await getAgents(asRole("admin", "/api/agents"), env);
    expect((await listed.json<{ agents: { status: null }[] }>()).agents[0]?.status).toBeNull();
  });

  it("falls back to idFromName for the settings stub", async () => {
    const { api } = world();
    const env = {
      SETTINGS: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => api,
      },
    } as unknown as AgentsHttpEnv;
    expect((await getAgents(asRole("admin", "/api/agents"), env)).status).toBe(200);
  });

  it("filters samples by role", async () => {
    const { env, users } = world();
    await users.addSample({ agent: "kit", kind: "turn", value: 1 });
    await users.addSample({ agent: "ada", kind: "turn", value: 2 });
    const all = await getSamples(asRole("admin", "/api/samples"), env);
    expect(await all.json()).toMatchObject({ samples: [{ agent: "ada" }, { agent: "kit" }] });
    const mine = await getSamples(asRole("operator", "/api/samples?agent=kit", ["kit"]), env);
    expect((await mine.json<{ samples: { agent: string }[] }>()).samples).toEqual([
      expect.objectContaining({ agent: "kit" }),
    ]);
    const scoped = await getSamples(asRole("operator", "/api/samples", ["kit"]), env);
    expect((await scoped.json<{ samples: unknown[] }>()).samples).toHaveLength(1);
    expect((await getSamples(asRole("operator", "/api/samples?agent=ada", ["kit"]), env)).status).toBe(403);
    expect((await getSamples(asRole("admin", "/api/samples?since=nope"), env)).status).toBe(400);
    expect((await getSamples(asRole("admin", "/api/samples?agent=Bad_Slug"), env)).status).toBe(400);
    expect((await getSamples(asRole("member", "/api/samples"), env)).status).toBe(403);
    expect((await getSamples(asRole("admin", "/api/samples?since=0"), env)).status).toBe(200);
  });

  it("answers 401, 400, and 503 on the unhappy paths", async () => {
    const { env, api } = world();
    const anon = new Request("https://g.test/api/agents");
    expect((await getAgents(anon, env)).status).toBe(401);
    expect((await postAgent(anon, env)).status).toBe(401);
    expect((await getAgent(anon, env, "kit")).status).toBe(401);
    expect((await deleteAgent(anon, env, "kit")).status).toBe(401);
    expect((await getAgentConfig(anon, env, "kit")).status).toBe(401);
    expect((await patchAgentConfig(anon, env, "kit")).status).toBe(401);
    expect((await getAgentStatus(anon, env, "kit")).status).toBe(401);
    expect((await getAgentLog(anon, env, "kit")).status).toBe(401);
    expect((await getAgentUsers(anon, env, "kit")).status).toBe(401);
    expect((await putAgentUsers(anon, env, "kit")).status).toBe(401);
    expect((await getSamples(anon, env)).status).toBe(401);

    const op = asRole("operator", "/api/agents/ada", ["kit"]);
    expect((await getAgentConfig(op, env, "ada")).status).toBe(403);
    expect((await patchAgentConfig(op, env, "ada")).status).toBe(403);
    expect((await getAgentStatus(op, env, "ada")).status).toBe(403);
    expect((await getAgentLog(op, env, "ada")).status).toBe(403);
    expect((await putAgentUsers(op, env, "ada")).status).toBe(403);

    const adminGet = asRole("admin", "/api/agents/bad");
    expect((await getAgentConfig(adminGet, env, "Bad_Slug")).status).toBe(400);
    expect((await getAgentUsers(adminGet, env, "Bad_Slug")).status).toBe(400);
    expect((await patchAgentConfig(adminGet, env, "Bad_Slug")).status).toBe(400);
    expect((await getAgentStatus(adminGet, env, "Bad_Slug")).status).toBe(400);
    expect((await getAgentLog(adminGet, env, "Bad_Slug")).status).toBe(400);
    expect((await putAgentUsers(adminGet, env, "Bad_Slug")).status).toBe(400);
    expect((await deleteAgent(asRole("admin", "/api/agents/bad", [], "DELETE"), env, "Bad_Slug")).status).toBe(400);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", "[]"), env)).status).toBe(400);

    expect(settingsApi({})).toBeNull();
    const bare = {};
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", "{}"), bare)).status).toBe(503);
    expect((await getAgent(adminGet, bare, "kit")).status).toBe(503);
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), bare, "kit")).status).toBe(503);
    expect((await getSamples(asRole("admin", "/api/samples"), bare)).status).toBe(503);

    await api.createAgent({ slug: "kit" }, ADA);
    const noAgent = { ...env, AGENT: undefined };
    expect((await getAgents(asRole("admin", "/api/agents"), noAgent)).status).toBe(200);
    expect((await getAgentConfig(adminGet, noAgent, "kit")).status).toBe(503);
    const badStatus = {
      ...env,
      AGENT: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({ fetch: () => Promise.resolve(new Response("no", { status: 500 })) }),
      },
    } as unknown as AgentsHttpEnv;
    const listed = await getAgents(asRole("admin", "/api/agents"), badStatus);
    expect((await listed.json<{ agents: { status: null }[] }>()).agents[0]?.status).toBeNull();

    api.listAgents = () => Promise.reject(new Error("down"));
    expect((await getAgents(asRole("admin", "/api/agents"), env)).status).toBe(503);
    api.createAgent = () => Promise.reject(new Error("down"));
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "zed" })), env)).status).toBe(503);
    api.getAgent = () => Promise.reject(new Error("down"));
    expect((await getAgent(adminGet, env, "kit")).status).toBe(503);
    api.deleteAgent = () => Promise.reject(new Error("down"));
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "kit")).status).toBe(503);
    api.listSamples = () => Promise.reject(new Error("down"));
    expect((await getSamples(asRole("admin", "/api/samples"), env)).status).toBe(503);
    expect((await getSamples(asRole("admin", "/api/samples?since=9007199254740993"), env)).status).toBe(400);
  });

  it("restarts for an admin or the operator who runs the agent", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    expect((await postAgentRestart(new Request("https://g.test/api/agents/kit/restart", { method: "POST" }), env, "kit")).status).toBe(401);
    expect((await postAgentRestart(asRole("member", "/api/agents/kit/restart", [], "POST"), env, "kit")).status).toBe(403);
    expect((await postAgentRestart(asRole("operator", "/api/agents/ada/restart", ["kit"], "POST"), env, "ada")).status).toBe(403);
    expect((await postAgentRestart(asRole("admin", "/api/agents/nope/restart", [], "POST"), env, "Bad_Slug")).status).toBe(400);
    const ok = await postAgentRestart(asRole("operator", "/api/agents/kit/restart", ["kit"], "POST"), env, "kit");
    expect(ok.status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "POST", op: "restart" });
    expect((await postAgentRestart(asRole("admin", "/api/agents/kit/restart", [], "POST"), env, "kit")).status).toBe(200);
  });
});

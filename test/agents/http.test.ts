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
  getAgentEnabled,
  postAgentEnabled,
  getAgentUsers,
  getSamples,
  patchAgentConfig,
  putAgentPersona,
  putAgentSelf,
  startAgentAuth,
  postAgent,
  postAgentClone,
  putAgentUsers,
  settingsApi,
  type AgentsHttpEnv,
} from "@/lib/agents/http";
import { emptyStatus } from "@/lib/agents/status";
import { openSettings, type SampleInput, type SampleQuery } from "@/lib/door/settingsStore";
import { memorySql } from "../door/memorySql";

const ADA = "118212345678901234567";
const MEM = "118200000000000000003";

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
  let destroyFails = false;
  let memoryImportFails = false;
  const clonePayload = { env: { SECRET: "sekrit" }, mcp: "toml", persona: "Be brief." };
  const api = {
    listAgents: () => agents.list(),
    getAgent: (slug: string) => agents.get(slug),
    createAgent: (input: AgentCreateBody, actor: string) => agents.create(input, actor),
    deleteAgent: (slug: string, actor: string) => agents.remove(slug, actor),
    setAgentEnabled: (slug: string, enabled: boolean, actor: string) => agents.setEnabled(slug, enabled, actor),
    deleteSamplesForAgent: (agent: string) => users.deleteSamplesForAgent(agent),
    removeSlugFromOperators: (slug: string) => users.removeSlugFromOperators(slug),
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
          if (op === "destroy") {
            if (destroyFails) {
              throw new Error("wipe failed");
            }
            return new Response(null, { status: 204 });
          }
          if (op === "pause") {
            return new Response(null, { status: 204 });
          }
          if (op === "status" || op === "restart") {
            return Response.json({ ...emptyStatus(), state: "ready", since: 50 });
          }
          if (op === "config") {
            return Response.json({ envKeys: ["A"], mcp: "toml", persona: "", updatedAt: 1, recreate: false });
          }
          if (op === "clone_export") {
            return Response.json(clonePayload);
          }
          if (op === "clone_import") {
            return Response.json({ ok: true });
          }
          if (op === "memory_export") {
            return Response.json({ rows: [{ id: 1, kind: "fact", subject: "x", content: "y", source: "chat", confidence: 1, created_at: "t", updated_at: "t", expires_at: null, superseded_by: null, consolidated: 0, consolidate_attempts: 0 }] });
          }
          if (op === "memory_import") {
            if (memoryImportFails) {
              return Response.json({ error: "bad_memory" }, { status: 400 });
            }
            return Response.json({ ok: true });
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
    setDestroyFails: (value: boolean) => {
      destroyFails = value;
    },
    setMemoryImportFails: (value: boolean) => {
      memoryImportFails = value;
    },
  };
}

describe("agents http", () => {
  it("lists every agent for an admin and refuses operators and members", async () => {
    const { env, agents } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);
    const all = await getAgents(asRole("admin", "/api/agents"), env);
    expect(all.status).toBe(200);
    const body = await all.json<{ agents: { slug: string; canMutate: boolean; status: { state: string } }[] }>();
    expect(body.agents.map((row) => row.slug)).toEqual(["ada", "kit"]);
    expect(body.agents.every((row) => row.canMutate && row.status.state === "ready")).toBe(true);

    expect((await getAgents(asRole("operator", "/api/agents", ["kit"]), env)).status).toBe(403);
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

  it("creates for an admin, refuses an operator, and destroys the agent", async () => {
    const { env, agents, users, calls } = world();
    const created = await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "Kit", tags: ["house"] })), env);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ agent: { slug: "kit", name: "kit", tags: ["house"], canMutate: true } });
    expect((await postAgent(asRole("operator", "/api/agents", ["kit"], "POST", "{}"), env)).status).toBe(403);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", "{"), env)).status).toBe(400);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "kit" })), env)).status).toBe(409);
    const nameTaken = await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "bob", name: "kit" })), env);
    expect(nameTaken.status).toBe(409);
    expect(await nameTaken.json()).toEqual({ error: "name_exists" });

    await users.addSample({ agent: "kit", kind: "turn", value: 1 });
    await users.putUser({ entry: "op@example.com", role: "operator", agents: ["kit", "ada"] }, ADA);
    const removed = await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "Kit");
    expect(removed.status).toBe(204);
    expect(await agents.get("kit")).toBeNull();
    expect(await users.listSamples({ agent: "kit" })).toHaveLength(0);
    expect((await users.list()).find((row) => row.entry.email === "op@example.com")?.agents).toEqual(["ada"]);
    expect(calls.some((c) => c.op === "destroy")).toBe(true);
    const destroyAt = calls.findIndex((c) => c.op === "destroy");
    expect(destroyAt).toBeGreaterThanOrEqual(0);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "kit")).status).toBe(404);
    expect((await deleteAgent(asRole("operator", "/api/agents/ada", ["kit"], "DELETE"), env, "ada")).status).toBe(403);
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
    const card = await getAgent(asRole("admin", "/api/agents/kit"), env, "kit");
    expect((await card.json<{ agent: { slug: string } }>()).agent.slug).toBe("kit");

    const opCard = await getAgent(asRole("operator", "/api/agents/kit", ["kit"]), env, "kit");
    expect(opCard.status).toBe(200);
    expect((await opCard.json<{ agent: { slug: string; canMutate: boolean } }>()).agent).toMatchObject({
      slug: "kit",
      canMutate: true,
    });
    expect((await getAgent(asRole("operator", "/api/agents/kit", ["ada"]), env, "kit")).status).toBe(403);
    expect((await getAgentConfig(asRole("operator", "/api/agents/kit/config", ["ada"]), env, "kit")).status).toBe(403);
    expect((await putAgentUsers(asRole("operator", "/api/agents/kit/users", ["ada"], "PUT", "{}"), env, "kit")).status).toBe(403);
    expect((await getAgent(asRole("member", "/api/agents/kit"), env, "kit")).status).toBe(403);
    expect(
      (await patchAgentConfig(asRole("member", "/api/agents/kit/config", [], "PATCH", "{}"), env, "kit")).status,
    ).toBe(403);

    expect((await getAgentConfig(asRole("operator", "/api/agents/kit/config", ["kit"]), env, "kit")).status).toBe(200);
    const opPatch = await patchAgentConfig(
      asRole("operator", "/api/agents/kit/config", ["kit"], "PATCH", JSON.stringify({ mcp: "toml" })),
      env,
      "kit",
    );
    expect(opPatch.status).toBe(200);
    expect((await getAgentUsers(asRole("operator", "/api/agents/kit/users", ["kit"]), env, "kit")).status).toBe(200);
    const opUsers = await putAgentUsers(
      asRole("operator", "/api/agents/kit/users", ["kit"], "PUT", JSON.stringify({ users: [{ sub: ADA }] })),
      env,
      "kit",
    );
    expect(opUsers.status).toBe(200);
    expect((await getAgentStatus(asRole("operator", "/api/agents/kit/status", ["kit"]), env, "kit")).status).toBe(200);
    expect((await postAgentRestart(asRole("operator", "/api/agents/kit/restart", ["kit"], "POST"), env, "kit")).status).toBe(200);
    expect((await getAgentLog(asRole("operator", "/api/agents/kit/log", ["kit"]), env, "kit")).status).toBe(200);
    expect((await getAgentPersona(asRole("operator", "/api/agents/kit/persona", ["kit"]), env, "kit")).status).toBe(200);

    expect((await getAgentConfig(asRole("admin", "/api/agents/kit/config"), env, "kit")).status).toBe(200);
    const patched = await patchAgentConfig(
      asRole("admin", "/api/agents/kit/config", [], "PATCH", JSON.stringify({ mcp: "toml" })),
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
    expect((await getAgentSelf(asRole("admin", "/api/agents/kit/self"), env, "kit")).status).toBe(200);
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
    expect((await post("operator", "kit", ["kit"], JSON.stringify({ plugin: "google" }))).status).toBe(200);
    const ok = await post("admin", "kit", [], JSON.stringify({ plugin: "google" }));
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
    expect((await getAgentPersona(asRole("admin", "/api/agents/kit/persona"), env, "kit")).status).toBe(200);
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

  it("lists samples for an admin only", async () => {
    const { env, users } = world();
    await users.addSample({ agent: "kit", kind: "turn", value: 1 });
    await users.addSample({ agent: "ada", kind: "turn", value: 2 });
    const all = await getSamples(asRole("admin", "/api/samples"), env);
    expect(await all.json()).toMatchObject({ samples: [{ agent: "ada" }, { agent: "kit" }] });
    expect((await getSamples(asRole("operator", "/api/samples?agent=kit", ["kit"]), env)).status).toBe(403);
    expect((await getSamples(asRole("operator", "/api/samples", ["kit"]), env)).status).toBe(403);
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

  it("reads enabled for admin and operator with the same control gate as POST", async () => {
    const { env, agents } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);

    const adminOn = await getAgentEnabled(asRole("admin", "/api/agents/kit/enabled"), env, "kit");
    expect(adminOn.status).toBe(200);
    expect(await adminOn.json()).toEqual({ enabled: true });

    await postAgentEnabled(
      asRole("admin", "/api/agents/kit/enabled", [], "POST", JSON.stringify({ enabled: false })),
      env,
      "kit",
    );
    const adminOff = await getAgentEnabled(asRole("admin", "/api/agents/kit/enabled"), env, "kit");
    expect(adminOff.status).toBe(200);
    expect(await adminOff.json()).toEqual({ enabled: false });

    const opOk = await getAgentEnabled(asRole("operator", "/api/agents/kit/enabled", ["kit"]), env, "kit");
    expect(opOk.status).toBe(200);
    expect(await opOk.json()).toEqual({ enabled: false });

    const opDenied = await getAgentEnabled(asRole("operator", "/api/agents/ada/enabled", ["kit"]), env, "ada");
    expect(opDenied.status).toBe(403);

    expect((await getAgentEnabled(new Request("https://g.test/api/agents/kit/enabled"), env, "kit")).status).toBe(401);

    expect((await getAgentEnabled(asRole("admin", "/api/agents/missing/enabled"), env, "missing")).status).toBe(404);
  });

  it("lets an operator control an assigned slug and forbids another", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);
    calls.length = 0;
    const off = await postAgentEnabled(
      asRole("operator", "/api/agents/kit/enabled", ["kit"], "POST", JSON.stringify({ enabled: false })),
      env,
      "kit",
    );
    expect(off.status).toBe(200);
    expect(await agents.get("kit")).toMatchObject({ enabled: false });
    expect(calls.some((c) => c.op === "pause")).toBe(true);
    calls.length = 0;
    expect((await deleteAgent(asRole("operator", "/api/agents/ada", ["kit"], "DELETE"), env, "ada")).status).toBe(403);
    expect(calls.some((c) => c.op === "destroy")).toBe(false);
    expect(await agents.get("ada")).not.toBeNull();
    const removed = await deleteAgent(asRole("operator", "/api/agents/kit", ["kit"], "DELETE"), env, "kit");
    expect(removed.status).toBe(204);
    expect(await agents.get("kit")).toBeNull();
  });

  it("lets a member on the room list destroy that slug and forbids others", async () => {
    const { agents, users } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);
    const calls: { op: string | null }[] = [];
    const env = {
      GANTREE_ALLOW: "member@example.com",
      DIRECTORY: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
      SETTINGS: {
        getByName: () => ({
          listAgents: () => agents.list(),
          getAgent: (slug: string) => agents.get(slug),
          createAgent: agents.create.bind(agents),
          deleteAgent: agents.remove.bind(agents),
          setAgentEnabled: agents.setEnabled.bind(agents),
          deleteSamplesForAgent: (agent: string) => users.deleteSamplesForAgent(agent),
          removeSlugFromOperators: (slug: string) => users.removeSlugFromOperators(slug),
          listSamples: users.listSamples.bind(users),
        }),
      },
      AGENT: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: (id: { toString(): string }) => ({
          fetch: async (req: Request) => {
            const op = req.headers.get("X-Chat-Op");
            calls.push({ op });
            const room = id.toString();
            if (op === "allow") {
              const users = room === "kit" ? [{ sub: MEM, email: "member@example.com" }] : [];
              return Response.json({ users });
            }
            if (op === "destroy") {
              return new Response(null, { status: 204 });
            }
            return new Response(null, { status: 204 });
          },
        }),
      },
    } as unknown as AgentsHttpEnv;
    const memberHeaders = {
      "x-gantree-sub": MEM,
      "x-gantree-email": "member@example.com",
      "x-gantree-role": "member",
      "x-gantree-agents": "",
    };
    const admitted = await getAgent(new Request("https://g.test/api/agents/kit", { headers: memberHeaders }), env, "kit");
    expect(admitted.status).toBe(200);
    expect((await admitted.json<{ agent: { slug: string; canMutate: boolean } }>()).agent).toMatchObject({
      slug: "kit",
      canMutate: true,
    });
    const denied = await deleteAgent(new Request("https://g.test/api/agents/ada", { method: "DELETE", headers: memberHeaders }), env, "ada");
    expect(denied.status).toBe(403);
    expect(calls.some((c) => c.op === "destroy")).toBe(false);
    calls.length = 0;
    const removed = await deleteAgent(new Request("https://g.test/api/agents/kit", { method: "DELETE", headers: memberHeaders }), env, "kit");
    expect(removed.status).toBe(204);
    expect(calls.some((c) => c.op === "destroy")).toBe(true);
    expect(await agents.get("kit")).toBeNull();
  });

  it("turns off, keeps the row, and blocks restart with off", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    const off = await postAgentEnabled(
      asRole("admin", "/api/agents/kit/enabled", [], "POST", JSON.stringify({ enabled: false })),
      env,
      "kit",
    );
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ agent: { slug: "kit", enabled: false } });
    expect(await agents.get("kit")).toMatchObject({ enabled: false });
    expect(calls.some((c) => c.op === "pause")).toBe(true);
    expect((await postAgentRestart(asRole("admin", "/api/agents/kit/restart", [], "POST"), env, "kit")).status).toBe(409);
    const blocked = await postAgentRestart(asRole("admin", "/api/agents/kit/restart", [], "POST"), env, "kit");
    expect(await blocked.json()).toEqual({ error: "off" });
  });

  it("resets idle anchor when an agent is re-enabled", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await postAgentEnabled(
      asRole("admin", "/api/agents/kit/enabled", [], "POST", JSON.stringify({ enabled: false })),
      env,
      "kit",
    );
    calls.length = 0;
    const on = await postAgentEnabled(
      asRole("admin", "/api/agents/kit/enabled", [], "POST", JSON.stringify({ enabled: true })),
      env,
      "kit",
    );
    expect(on.status).toBe(200);
    expect(calls.some((c) => c.op === "idle_reset")).toBe(true);
  });

  it("keeps the inventory row when the durable object wipe fails", async () => {
    const { env, agents, setDestroyFails } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    setDestroyFails(true);
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "kit")).status).toBe(503);
    expect(await agents.get("kit")).toMatchObject({ slug: "kit" });
  });

  it("clones keys without memory ops and never returns env values", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    calls.length = 0;
    const res = await postAgentClone(
      asRole("admin", "/api/agents/kit/clone", [], "POST", JSON.stringify({ slug: "copy", name: "Copy" })),
      env,
      "kit",
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ agent: Record<string, unknown> }>();
    expect(body.agent).toMatchObject({ slug: "copy", name: "Copy", canMutate: true });
    expect(body.agent).not.toHaveProperty("env");
    expect(body.agent).not.toHaveProperty("envKeys");
    expect(JSON.stringify(body)).not.toContain("sekrit");
    expect(await agents.get("copy")).not.toBeNull();
    const ops = calls.map((c) => c.op);
    expect(ops).toContain("clone_export");
    expect(ops).toContain("clone_import");
    expect(ops).toContain("bearer");
    expect(ops.filter((op) => op === "memory_export")).toHaveLength(0);
    expect(ops.filter((op) => op === "memory_import")).toHaveLength(0);
  });

  it("clones with memories when asked", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    calls.length = 0;
    const res = await postAgentClone(
      asRole("admin", "/api/agents/kit/clone", [], "POST", JSON.stringify({ slug: "memcopy", memories: true })),
      env,
      "kit",
    );
    expect(res.status).toBe(201);
    const ops = calls.map((c) => c.op);
    expect(ops.filter((op) => op === "memory_export")).toHaveLength(1);
    expect(ops.filter((op) => op === "memory_import")).toHaveLength(1);
    expect(await agents.get("memcopy")).not.toBeNull();
  });

  it("refuses clone when the caller cannot control the source", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    calls.length = 0;
    const res = await postAgentClone(
      asRole("operator", "/api/agents/kit/clone", ["ada"], "POST", JSON.stringify({ slug: "sneak" })),
      env,
      "kit",
    );
    expect(res.status).toBe(403);
    expect(await agents.get("sneak")).toBeNull();
    expect(calls.some((c) => c.op === "clone_export")).toBe(false);
  });

  it("removes the new inventory row when memory import fails", async () => {
    const { env, agents, setMemoryImportFails } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    setMemoryImportFails(true);
    const res = await postAgentClone(
      asRole("admin", "/api/agents/kit/clone", [], "POST", JSON.stringify({ slug: "half", memories: true })),
      env,
      "kit",
    );
    expect(res.status).toBe(503);
    expect(await agents.get("half")).toBeNull();
  });

  it("restarts when the caller controls the slug", async () => {
    const { env, agents, calls } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    expect((await postAgentRestart(new Request("https://g.test/api/agents/kit/restart", { method: "POST" }), env, "kit")).status).toBe(401);
    expect((await postAgentRestart(asRole("member", "/api/agents/kit/restart", [], "POST"), env, "kit")).status).toBe(403);
    expect((await postAgentRestart(asRole("operator", "/api/agents/ada/restart", ["kit"], "POST"), env, "ada")).status).toBe(403);
    expect((await postAgentRestart(asRole("admin", "/api/agents/nope/restart", [], "POST"), env, "Bad_Slug")).status).toBe(400);
    expect((await postAgentRestart(asRole("operator", "/api/agents/kit/restart", ["kit"], "POST"), env, "kit")).status).toBe(200);
    expect((await postAgentRestart(asRole("admin", "/api/agents/kit/restart", [], "POST"), env, "kit")).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: "POST", op: "restart" });
  });
});

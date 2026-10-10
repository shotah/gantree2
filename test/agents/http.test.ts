import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRegistry, type AgentCreateBody } from "@/lib/agents/registry";
import {
  deleteAgent,
  getAgent,
  getAgentConfig,
  getAgentLog,
  getAgents,
  getAgentStatus,
  getAgentUsers,
  getSamples,
  handleSnapshot,
  patchAgentConfig,
  postAgent,
  putAgentUsers,
  settingsApi,
  type AgentsHttpEnv,
} from "@/lib/agents/http";
import { signSnapshot, type SnapshotStore } from "@/lib/agents/snapshot";
import { emptyStatus } from "@/lib/agents/status";
import { openSettings, type SampleInput, type SampleQuery } from "@/lib/door/settingsStore";
import { memorySql } from "../door/memorySql";

const container = vi.hoisted(() => ({
  info: vi.fn((_env: unknown, _slug: unknown) => Promise.resolve({ state: "unknown" as const, since: null, lastError: null, image: null })),
  act: vi.fn((_env: unknown, _slug: unknown, _action: unknown) => Promise.resolve({ state: "unknown" as const, since: null, lastError: null, image: null })),
}));

vi.mock("@/lib/agents/container", () => ({
  containerInfo: (env: unknown, slug: unknown) => container.info(env, slug),
  containerAct: (env: unknown, slug: unknown, action: unknown) => container.act(env, slug, action),
  UNKNOWN_CONTAINER: { state: "unknown", since: null, lastError: null, image: null },
}));

const ADA = "118212345678901234567";
const now = 1_700_000_000_000;

class MemR2 implements SnapshotStore {
  objects = new Map<string, Uint8Array>();
  fail = false;

  get(key: string) {
    const hit = this.objects.get(key);
    if (!hit) {
      return Promise.resolve(null);
    }
    const copy = hit.slice();
    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)),
    });
  }

  put(key: string, value: ArrayBuffer | ArrayBufferView) {
    if (this.fail) {
      throw new Error("r2");
    }
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this.objects.set(key, bytes.slice());
    return Promise.resolve();
  }
}

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
  const bucket = new MemR2();
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
          if (op === "status") {
            return Response.json({ ...emptyStatus(), harness: "connected", since: 50 });
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
    STORE: bucket,
  } as unknown as AgentsHttpEnv;
  return {
    env,
    api,
    bucket,
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
  beforeEach(() => {
    container.info.mockReset();
    container.act.mockReset();
    container.info.mockResolvedValue({ state: "unknown", since: null, lastError: null, image: null });
    container.act.mockResolvedValue({ state: "unknown", since: null, lastError: null, image: null });
  });

  it("lists every agent for an admin and only runnable ones for an operator", async () => {
    const { env, agents } = world();
    await agents.create({ slug: "kit", name: "Kit" }, ADA);
    await agents.create({ slug: "ada", name: "Ada" }, ADA);
    const all = await getAgents(asRole("admin", "/api/agents"), env);
    expect(all.status).toBe(200);
    const body = await all.json<{ agents: { slug: string; canMutate: boolean; status: { harness: string }; container: { state: string } }[] }>();
    expect(body.agents.map((row) => row.slug)).toEqual(["ada", "kit"]);
    expect(body.agents.every((row) => row.canMutate && row.status.harness === "connected" && row.container.state === "unknown")).toBe(true);

    const mine = await getAgents(asRole("operator", "/api/agents", ["kit"]), env);
    expect((await mine.json<{ agents: { slug: string; canMutate: boolean }[] }>()).agents).toEqual([
      expect.objectContaining({ slug: "kit", canMutate: true }),
    ]);
    expect((await getAgents(asRole("member", "/api/agents"), env)).status).toBe(403);
    expect((await getAgents(new Request("https://g.test/api/agents"), env)).status).toBe(401);
  });

  it("creates for an admin, refuses an operator, and deletes after stopping the container", async () => {
    const { env, agents, bucket, users } = world();
    bucket.objects.set("backups/kit/latest/gantry_db", new Uint8Array([1]));
    const created = await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "Kit", tags: ["house"] })), env);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ agent: { slug: "kit", name: "kit", tags: ["house"], canMutate: true } });
    expect((await postAgent(asRole("operator", "/api/agents", ["kit"], "POST", "{}"), env)).status).toBe(403);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", "{"), env)).status).toBe(400);
    expect((await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "kit" })), env)).status).toBe(409);

    await users.addSample({ agent: "kit", kind: "turn", value: 1 });
    container.act.mockImplementationOnce(() => agents.get("kit").then((row) => {
      expect(row).not.toBeNull();
      return { state: "unknown" as const, since: null, lastError: null, image: null };
    }));
    const removed = await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "Kit");
    expect(removed.status).toBe(204);
    expect(container.act).toHaveBeenCalledWith(env, "kit", { action: "stop" });
    expect(await agents.get("kit")).toBeNull();
    expect(await users.listSamples({ agent: "kit" })).toHaveLength(1);
    expect(bucket.objects.has("backups/kit/latest/gantry_db")).toBe(true);
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "kit")).status).toBe(404);
    expect((await deleteAgent(asRole("operator", "/api/agents/kit", ["kit"], "DELETE"), env, "kit")).status).toBe(403);
  });

  it("keeps the row when the container stop throws", async () => {
    const { env, agents } = world();
    await agents.create({ slug: "kit" }, ADA);
    container.act.mockRejectedValueOnce(new Error("nope"));
    expect((await deleteAgent(asRole("admin", "/api/agents/kit", [], "DELETE"), env, "kit")).status).toBe(503);
    expect(await agents.get("kit")).not.toBeNull();
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

  it("returns 503 when settings or the agent stub fails", async () => {
    const { env, setDown } = world();
    expect(settingsApi({ SETTINGS: {} } as AgentsHttpEnv)).toBeNull();
    expect((await getAgents(asRole("admin", "/api/agents"), { SETTINGS: {} } as AgentsHttpEnv)).status).toBe(503);
    setDown(true);
    const created = await postAgent(asRole("admin", "/api/agents", [], "POST", JSON.stringify({ slug: "kit" })), env);
    expect(created.status).toBe(201);
    expect((await created.json<{ agent: { status: null } }>()).agent.status).toBeNull();
    expect((await getAgentConfig(asRole("admin", "/api/agents/kit/config"), env, "kit")).status).toBe(503);
    container.info.mockRejectedValueOnce(new Error("container"));
    const listed = await getAgents(asRole("admin", "/api/agents"), env);
    expect((await listed.json<{ agents: { container: { state: string } }[] }>()).agents[0]?.container.state).toBe("unknown");
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

    const exp = now + 60_000;
    const sig = await signSnapshot("room-secret", "kit", "gantry_db", "GET", exp);
    vi.spyOn(crypto.subtle, "verify").mockRejectedValueOnce(new Error("hmac"));
    expect((await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${sig}`),
      env,
      "kit",
      "gantry_db",
      { now },
    )).status).toBe(401);
  });
});

describe("snapshot http", () => {
  it("serves and stores a signed body and rejects a bad sig", async () => {
    const { env, bucket, setBearer } = world();
    const exp = now + 60_000;
    const sig = await signSnapshot("room-secret", "kit", "gantry_db", "PUT", exp);
    const put = await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${sig}&stamp=20261010T120000Z`, {
        method: "PUT",
        body: new Uint8Array([7, 8]),
      }),
      env,
      "kit",
      "gantry_db",
      { now },
    );
    expect(put.status).toBe(204);
    expect(bucket.objects.has("backups/kit/latest/gantry_db")).toBe(true);
    expect(bucket.objects.has("backups/kit/20261010T120000Z/gantry_db")).toBe(true);
    const getSig = await signSnapshot("room-secret", "kit", "gantry_db", "GET", exp);
    const got = await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${getSig}`, { method: "GET" }),
      env,
      "Kit",
      "gantry_db",
      { now },
    );
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array([7, 8]));
    const missing = await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/self_md?exp=${exp}&sig=${await signSnapshot("room-secret", "kit", "self_md", "GET", exp)}`),
      env,
      "kit",
      "self_md",
      { now },
    );
    expect(missing.status).toBe(404);
    const bad = await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=abcd`, { method: "GET" }),
      env,
      "kit",
      "gantry_db",
      { now },
    );
    expect(bad.status).toBe(401);
    expect((await handleSnapshot(new Request("https://g.test/api/agents/kit/snapshot/other"), env, "kit", "other")).status).toBe(404);
    expect((await handleSnapshot(new Request("https://g.test/api/agents/kit/snapshot/gantry_db", { method: "DELETE" }), env, "kit", "gantry_db")).status).toBe(405);
    const huge = await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${sig}`, { method: "PUT", body: new Uint8Array([1, 2, 3, 4]) }),
      env,
      "kit",
      "gantry_db",
      { now, maxBytes: 3 },
    );
    expect(huge.status).toBe(413);
    setBearer(null);
    expect((await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${sig}`),
      env,
      "kit",
      "gantry_db",
      { now },
    )).status).toBe(401);
    const noStore = { ...env, STORE: undefined };
    setBearer("room-secret");
    expect((await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${getSig}`),
      noStore,
      "kit",
      "gantry_db",
      { now },
    )).status).toBe(503);
    bucket.fail = true;
    expect((await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${sig}`, { method: "PUT", body: new Uint8Array([1]) }),
      env,
      "kit",
      "gantry_db",
      { now },
    )).status).toBe(503);
    expect((await handleSnapshot(
      new Request(`https://g.test/api/agents/kit/snapshot/gantry_db?exp=${exp}&sig=${getSig}`),
      { STORE: bucket } as unknown as AgentsHttpEnv,
      "kit",
      "gantry_db",
      { now },
    )).status).toBe(503);
  });
});

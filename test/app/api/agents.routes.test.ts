import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRegistry } from "@/lib/agents/registry";
import { signSnapshot } from "@/lib/agents/snapshot";
import { openSettings } from "@/lib/door/settingsStore";
import { memorySql } from "../../door/memorySql";

const door = vi.hoisted(() => {
  const env: Record<string, unknown> = {};
  return { env };
});

vi.mock("@/lib/door/runtime", () => ({
  doorEnv: () => door.env,
}));

import { GET as listAgents, POST as createAgent } from "@/app/api/agents/route";
import { DELETE as removeAgent, GET as readAgent } from "@/app/api/agents/[slug]/route";
import { GET as readConfig } from "@/app/api/agents/[slug]/config/route";
import { GET as readStatus } from "@/app/api/agents/[slug]/status/route";
import { GET as readLog } from "@/app/api/agents/[slug]/log/route";
import { GET as readUsers } from "@/app/api/agents/[slug]/users/route";
import { GET as readBearer } from "@/app/api/agents/[slug]/bearer/route";
import { GET as readSnap } from "@/app/api/agents/[slug]/snapshot/[file]/route";
import { GET as readSamples } from "@/app/api/samples/route";

const ADA = "118212345678901234567";

function admin(path: string, method = "GET", body?: string) {
  return new Request(`https://g.test${path}`, {
    method,
    headers: {
      "x-gantree-sub": ADA,
      "x-gantree-email": "ada@example.com",
      "x-gantree-role": "admin",
      "x-gantree-agents": "",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

describe("agent routes", () => {
  beforeEach(() => {
    const sql = memorySql();
    const users = openSettings(sql, () => 1);
    const agents = openRegistry(sql, () => 1);
    door.env = {
      SETTINGS: {
        getByName: () => ({
          listAgents: () => agents.list(),
          getAgent: (slug: string) => agents.get(slug),
          createAgent: (input: { slug: unknown; name?: unknown; tags?: unknown }, actor: string) => agents.create(input, actor),
          deleteAgent: (slug: string, actor: string) => agents.remove(slug, actor),
          listSamples: (query?: { agent?: string }) => users.listSamples(query),
        }),
      },
      STORE: {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(undefined),
      },
      AGENT: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          fetch: (req: Request) => {
            const op = req.headers.get("X-Chat-Op");
            if (op === "bearer") {
              return Response.json({ bearer: "room-secret" });
            }
            if (op === "allow") {
              return Response.json({ users: [] });
            }
            if (op === "status") {
              return Response.json({
                harness: "disconnected",
                since: null,
                published: [],
                skipped: [],
                lastTurn: null,
                lastSnapshot: null,
                lastError: null,
                perf: { turns: 0, prompt: 0, completion: 0, errors: 0 },
              });
            }
            return Promise.resolve(Response.json({ envKeys: [], mcp: "", persona: "", updatedAt: null, recreate: false }));
          },
        }),
      },
    };
  });

  it("wires list, create, read, and the room ops", async () => {
    const slug = { params: Promise.resolve({ slug: "kit" }) };
    expect((await createAgent(admin("/api/agents", "POST", JSON.stringify({ slug: "kit", name: "Kit" })))).status).toBe(201);
    expect((await listAgents(admin("/api/agents"))).status).toBe(200);
    expect((await readAgent(admin("/api/agents/kit"), slug)).status).toBe(200);
    expect((await readConfig(admin("/api/agents/kit/config"), slug)).status).toBe(200);
    expect((await readStatus(admin("/api/agents/kit/status"), slug)).status).toBe(200);
    expect((await readLog(admin("/api/agents/kit/log"), slug)).status).toBe(200);
    expect((await readUsers(admin("/api/agents/kit/users"), slug)).status).toBe(200);
    expect((await readSamples(admin("/api/samples"))).status).toBe(200);
    expect((await removeAgent(admin("/api/agents/kit", "DELETE"), slug)).status).toBe(204);
  });

  it("hands the room bearer to an admin only on the loopback dev door", async () => {
    const slug = { params: Promise.resolve({ slug: "kit" }) };
    expect((await readBearer(admin("/api/agents/kit/bearer"), slug)).status).toBe(404);
    door.env.GANTREE_DEV_USER = `${ADA}:ada@example.com`;
    expect((await readBearer(admin("/api/agents/kit/bearer"), slug)).status).toBe(404);
    const local = new Request("http://127.0.0.1:3000/api/agents/kit/bearer", { headers: admin("/x").headers });
    const res = await readBearer(local, slug);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bearer: "room-secret" });
  });

  it("answers a signed snapshot without a session", async () => {
    const exp = Date.now() + 60_000;
    const sig = await signSnapshot("room-secret", "kit", "self_md", "GET", exp);
    const res = await readSnap(
      new Request(`https://g.test/api/agents/kit/snapshot/self_md?exp=${exp}&sig=${sig}`),
      { params: Promise.resolve({ slug: "kit", file: "self_md" }) },
    );
    expect(res.status).toBe(404);
  });
});

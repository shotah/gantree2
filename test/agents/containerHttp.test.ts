import { describe, expect, it } from "vitest";
import { getContainer, postContainer } from "@/lib/agents/containerHttp";
import type { AgentsEnv, ContainerInfo } from "@/lib/agents/types";

const STOPPED: ContainerInfo = { state: "stopped", since: null, lastError: null, image: null };

function headers(role: "admin" | "operator" | "member", agents: string[] = []): HeadersInit {
  return {
    "x-gantree-sub": "118212345678901234567",
    "x-gantree-email": "ada@example.com",
    "x-gantree-role": role,
    "x-gantree-agents": agents.join(","),
  };
}

function harnessEnv(info: ContainerInfo = STOPPED) {
  const ops: { op: string | null; body: unknown }[] = [];
  const env = {
    HARNESS: {
      idFromName: (name: string) => ({ name }) as DurableObjectId,
      get: () => ({
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(input, init);
          const body = req.method === "GET" ? null : await req.json();
          ops.push({ op: req.headers.get("X-Harness-Op"), body });
          return Response.json(info);
        },
      }),
    },
    AGENT: {
      idFromName: (name: string) => ({ name }) as DurableObjectId,
      get: () => ({
        fetch: async () => Response.json({ bearer: "tok" }),
      }),
    },
  } as unknown as AgentsEnv;
  return { env, ops };
}

describe("container http", () => {
  it("403 without a principal, for a member, and for an operator of another agent", async () => {
    const { env } = harnessEnv();
    expect((await getContainer(new Request("https://gantree.example/api/agents/kit/container"), env, "kit")).status).toBe(403);
    expect((await getContainer(new Request("https://gantree.example/api/agents/kit/container", { headers: headers("member", ["kit"]) }), env, "kit")).status).toBe(403);
    const other = await postContainer(
      new Request("https://gantree.example/api/agents/kit/container", {
        method: "POST",
        headers: headers("operator", ["ada"]),
        body: JSON.stringify({ action: "stop" }),
      }),
      env,
      "kit",
    );
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ error: "forbidden" });
  });

  it("400 on a bad slug or a bad action", async () => {
    const { env } = harnessEnv();
    const slug = await getContainer(
      new Request("https://gantree.example/api/agents/1nope/container", { headers: headers("admin") }),
      env,
      "1nope",
    );
    expect(slug.status).toBe(400);
    expect(await slug.json()).toEqual({ error: "bad slug" });

    const json = await postContainer(
      new Request("https://gantree.example/api/agents/kit/container", {
        method: "POST",
        headers: headers("admin"),
        body: "nope",
      }),
      env,
      "kit",
    );
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: "bad json" });

    const action = await postContainer(
      new Request("https://gantree.example/api/agents/kit/container", {
        method: "POST",
        headers: headers("admin"),
        body: JSON.stringify({ action: "explode" }),
      }),
      env,
      "kit",
    );
    expect(action.status).toBe(400);
    expect(await action.json()).toEqual({ error: "bad action" });
  });

  it("lets an operator of the slug read and stop, and an admin start", async () => {
    const { env, ops } = harnessEnv();
    const got = await getContainer(
      new Request("https://gantree.example/api/agents/Kit/container", { headers: headers("operator", ["kit"]) }),
      env,
      "Kit",
    );
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(STOPPED);
    expect(ops).toEqual([{ op: "info", body: null }]);

    const stopped = await postContainer(
      new Request("https://gantree.example/api/agents/kit/container", {
        method: "POST",
        headers: headers("operator", ["kit"]),
        body: JSON.stringify({ action: "stop" }),
      }),
      env,
      "kit",
    );
    expect(stopped.status).toBe(200);
    expect(ops.at(-1)).toEqual({ op: "stop", body: null });

    const started = await postContainer(
      new Request("https://app.example/api/agents/kit/container", {
        method: "POST",
        headers: headers("admin"),
        body: JSON.stringify({ action: "start" }),
      }),
      env,
      "kit",
    );
    expect(started.status).toBe(200);
    expect(ops.at(-1)).toEqual({
      op: "start",
      body: { origin: "https://app.example", bearer: "tok" },
    });
  });

  it("reports unknown when the binding is missing", async () => {
    const res = await getContainer(
      new Request("https://gantree.example/api/agents/kit/container", { headers: headers("admin") }),
      {},
      "kit",
    );
    expect(await res.json()).toEqual({ state: "unknown", since: null, lastError: null, image: null });
  });
});

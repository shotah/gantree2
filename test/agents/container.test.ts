import { describe, expect, it } from "vitest";
import { containerAct, containerInfo, resolveOrigin, UNKNOWN_CONTAINER } from "@/lib/agents/container";
import type { AgentsEnv, ContainerInfo } from "@/lib/agents/types";

type Call = { ns: "agent" | "harness"; op: string | null; method: string; body: unknown };

function running(): ContainerInfo {
  return { state: "running", since: 1, lastError: null, image: "./harness/Dockerfile" };
}

function namespace(opts: {
  bearer?: string | null;
  info?: ContainerInfo;
  configStatus?: number;
  throwOn?: "bearer" | "config" | "harness";
}) {
  const calls: Call[] = [];
  const agent = {
    idFromName: (name: string) => ({ name, toString: () => name }) as DurableObjectId,
    get: () => ({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const op = req.headers.get("X-Chat-Op");
        const body = req.method === "GET" ? null : await req.json();
        calls.push({ ns: "agent", op, method: req.method, body });
        if (op === "bearer") {
          if (opts.throwOn === "bearer") {
            throw new Error("agent down");
          }
          if (!opts.bearer) {
            return new Response("no", { status: 404 });
          }
          return Response.json({ bearer: opts.bearer });
        }
        if (opts.throwOn === "config") {
          throw new Error("config down");
        }
        return new Response("no", { status: opts.configStatus ?? 404 });
      },
    }),
  } as unknown as DurableObjectNamespace;

  const harness = {
    idFromName: (name: string) => ({ name, toString: () => name }) as DurableObjectId,
    get: () => ({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const op = req.headers.get("X-Harness-Op");
        const body = req.method === "GET" ? null : await req.json();
        calls.push({ ns: "harness", op, method: req.method, body });
        if (opts.throwOn === "harness") {
          throw new Error("harness down");
        }
        if (op === "info" || op === "start" || op === "recreate" || op === "stop") {
          return Response.json(opts.info ?? running());
        }
        return Response.json({ nope: true });
      },
    }),
  } as unknown as DurableObjectNamespace;

  const env = { AGENT: agent, HARNESS: harness } as AgentsEnv;
  return { env, calls };
}

describe("resolveOrigin", () => {
  it("prefers PUBLIC_ORIGIN and otherwise uses the fallback", () => {
    expect(resolveOrigin({ PUBLIC_ORIGIN: "https://edge.example/path" } as AgentsEnv, "http://127.0.0.1:3000")).toBe("https://edge.example");
    expect(resolveOrigin({}, "http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(resolveOrigin({ PUBLIC_ORIGIN: "not a url" } as AgentsEnv, "http://127.0.0.1:3000")).toBeNull();
    expect(resolveOrigin({}, undefined)).toBeNull();
  });
});

describe("containerInfo", () => {
  it("is unknown without a binding and never throws", async () => {
    await expect(containerInfo({}, "kit")).resolves.toBe(UNKNOWN_CONTAINER);
    const { env } = namespace({ throwOn: "harness" });
    const info = await containerInfo(env, "kit");
    expect(info.state).toBe("failed");
    expect(info.lastError).toBe("harness down");
  });

  it("returns the harness body", async () => {
    const { env, calls } = namespace({ info: { state: "stopped", since: null, lastError: null, image: null } });
    await expect(containerInfo(env, "kit")).resolves.toEqual({ state: "stopped", since: null, lastError: null, image: null });
    expect(calls).toEqual([{ ns: "harness", op: "info", method: "GET", body: null }]);
  });

  it("turns a bad body into failed", async () => {
    const { env } = namespace({});
    env.HARNESS = {
      idFromName: (name: string) => ({ name }) as DurableObjectId,
      get: () => ({ fetch: async () => Response.json({ nope: true }) }),
    } as unknown as DurableObjectNamespace;
    const info = await containerInfo(env, "kit");
    expect(info.state).toBe("failed");
    expect(info.lastError).toMatch(/harness 200/);
  });
});

describe("containerAct", () => {
  it("is unknown without a binding", async () => {
    await expect(containerAct({}, "kit", { action: "stop" })).resolves.toBe(UNKNOWN_CONTAINER);
  });

  it("stops without reading the bearer", async () => {
    const { env, calls } = namespace({ bearer: "tok" });
    const info = await containerAct(env, "kit", { action: "stop" });
    expect(info.state).toBe("running");
    expect(calls).toEqual([{ ns: "harness", op: "stop", method: "GET", body: null }]);
  });

  it("starts with origin and bearer, then tells the agent", async () => {
    const { env, calls } = namespace({ bearer: "tok", configStatus: 404 });
    const info = await containerAct(env, "kit", { action: "start" }, "https://gantree.example/chat");
    expect(info.state).toBe("running");
    expect(calls[0]).toEqual({ ns: "agent", op: "bearer", method: "GET", body: null });
    expect(calls[1]).toEqual({
      ns: "harness",
      op: "start",
      method: "POST",
      body: { origin: "https://gantree.example", bearer: "tok" },
    });
    expect(calls[2]).toMatchObject({
      ns: "agent",
      op: "config",
      method: "POST",
      body: { started: true },
    });
  });

  it("uses PUBLIC_ORIGIN ahead of the request origin", async () => {
    const { env, calls } = namespace({ bearer: "tok" });
    (env as AgentsEnv & { PUBLIC_ORIGIN: string }).PUBLIC_ORIGIN = "https://edge.example";
    await containerAct(env, "kit", { action: "recreate" }, "http://127.0.0.1:3000");
    expect(calls[1]).toMatchObject({
      op: "recreate",
      body: { origin: "https://edge.example", bearer: "tok" },
    });
  });

  it("fails closed without origin or bearer and skips the config poke", async () => {
    const noOrigin = namespace({ bearer: "tok" });
    const missing = await containerAct(noOrigin.env, "kit", { action: "start" });
    expect(missing).toMatchObject({ state: "failed", lastError: "no origin" });
    expect(noOrigin.calls).toEqual([]);

    const noBearer = namespace({ bearer: null });
    const denied = await containerAct(noBearer.env, "kit", { action: "start" }, "https://gantree.example");
    expect(denied).toMatchObject({ state: "failed", lastError: "no bearer" });
    expect(noBearer.calls.map((call) => call.ns)).toEqual(["agent"]);
  });

  it("ignores a config 426 and a config throw after a successful start", async () => {
    const gone = namespace({ bearer: "tok", configStatus: 426 });
    await expect(containerAct(gone.env, "kit", { action: "start" }, "https://gantree.example")).resolves.toMatchObject({ state: "running" });

    const down = namespace({ bearer: "tok", throwOn: "config" });
    await expect(containerAct(down.env, "kit", { action: "start" }, "https://gantree.example")).resolves.toMatchObject({ state: "running" });
  });

  it("does not poke config when the harness reports failed", async () => {
    const { env, calls } = namespace({
      bearer: "tok",
      info: { state: "failed", since: 2, lastError: "no docker", image: null },
    });
    const info = await containerAct(env, "kit", { action: "start" }, "https://gantree.example");
    expect(info.lastError).toBe("no docker");
    expect(calls.map((call) => call.op)).toEqual(["bearer", "start"]);
  });
});

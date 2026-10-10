import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  WorkerEntrypoint: class {
    constructor(_ctx: unknown, _env: unknown) {}
  },
}));

import { HARNESS_IMAGE, HARNESS_PORT, Harness, harnessProcessEnv } from "@/edge/harness.do";
import type { ContainerInfo } from "@/lib/agents/types";

class FakeContainer {
  running = false;
  explode = false;
  started: { env?: Record<string, string>; enableInternet?: boolean }[] = [];
  signals: number[] = [];
  destroyed = 0;

  start(config: { env?: Record<string, string>; enableInternet?: boolean }): void {
    if (this.explode) {
      throw new Error("no docker");
    }
    this.running = true;
    this.started.push(config);
  }

  getTcpPort(): { fetch: () => Promise<Response> } {
    return {
      fetch: () => Promise.reject(new Error("the container is not listening")),
    };
  }

  monitor(): Promise<never> {
    return new Promise(() => {});
  }

  signal(code: number): void {
    this.signals.push(code);
    this.running = false;
  }

  destroy(): void {
    this.destroyed += 1;
    this.running = false;
  }
}

class FakeStorage {
  rows = new Map<string, unknown>();
  history: ContainerInfo[] = [];
  failPut = false;

  async get<T>(key: string): Promise<T | undefined> {
    return this.rows.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (this.failPut && key === "container-info") {
      throw new Error("disk");
    }
    if (key === "container-info" && isInfo(value)) {
      this.history.push(value);
    }
    this.rows.set(key, value);
  }

  async setAlarm(): Promise<void> {
    // The Container class arms a DO alarm. These tests never fire it.
  }

  async deleteAlarm(): Promise<void> {
    // see setAlarm
  }

  async sync(): Promise<void> {
    // see setAlarm
  }

  sql = { exec: () => [] };

  kv = {
    get: () => undefined,
    put: () => undefined,
  };
}

function isInfo(value: unknown): value is ContainerInfo {
  return !!value && typeof value === "object" && "state" in value && "lastError" in value;
}

function ctxFor(storage: FakeStorage, container: FakeContainer, name = "kit") {
  return {
    id: { name, toString: () => name, equals: () => false },
    container,
    storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    abort: () => undefined,
  };
}

async function boot(name = "kit", storage = new FakeStorage(), container = new FakeContainer()) {
  const harness = new Harness(
    ctxFor(storage, container, name) as unknown as ConstructorParameters<typeof Harness>[0],
    {},
  );
  await Promise.resolve();
  await Promise.resolve();
  return { harness, storage, container };
}

function op(name: string, body?: unknown): Request {
  return new Request("https://harness/", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Harness-Op": name,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function read(res: Response): Promise<ContainerInfo> {
  return res.json<ContainerInfo>();
}

describe("harnessProcessEnv", () => {
  it("dials wss for https and ws for http, with the slug in the path", () => {
    expect(harnessProcessEnv("https://gantree.example/ignored", "kit", "tok")).toEqual({
      CHANNEL: "pendant",
      PENDANT_MAILBOX_URL: "wss://gantree.example/ws/kit",
      PENDANT_BEARER: "tok",
      SNAPSHOT: "true",
      SNAPSHOT_INTERVAL: "5m",
    });
    expect(harnessProcessEnv("http://127.0.0.1:3000", "ada", "t").PENDANT_MAILBOX_URL).toBe("ws://127.0.0.1:3000/ws/ada");
  });
});

describe("Harness", () => {
  it("reports unknown when the container runtime throws", async () => {
    const storage = new FakeStorage();
    const container = new FakeContainer();
    let live = false;
    Object.defineProperty(container, "running", {
      get() {
        if (live) {
          throw new Error("no docker");
        }
        return false;
      },
    });
    const { harness } = await boot("kit", storage, container);
    live = true;
    const info = await read(await harness.fetch(op("info")));
    expect(info).toEqual({ state: "unknown", since: null, lastError: null, image: null });
    expect(storage.rows.has("container-info")).toBe(false);
  });

  it("reports stopped until start, and probes port 8080 with a 2h sleep", async () => {
    const { harness } = await boot();
    expect(harness.defaultPort).toBe(HARNESS_PORT);
    expect(harness.sleepAfter).toBe("2h");
    const info = await read(await harness.fetch(op("info")));
    expect(info).toEqual({ state: "stopped", since: null, lastError: null, image: null });
  });

  it("starts with the dial-back env and records running", async () => {
    const { harness, container, storage } = await boot();
    const info = await read(await harness.fetch(op("start", { origin: "https://gantree.example", bearer: "tok" })));
    expect(info.state).toBe("running");
    expect(info.image).toBe(HARNESS_IMAGE);
    expect(info.lastError).toBeNull();
    expect(typeof info.since).toBe("number");
    expect(container.started).toEqual([{
      enableInternet: true,
      env: {
        CHANNEL: "pendant",
        PENDANT_MAILBOX_URL: "wss://gantree.example/ws/kit",
        PENDANT_BEARER: "tok",
        SNAPSHOT: "true",
        SNAPSHOT_INTERVAL: "5m",
      },
    }]);
    expect(storage.history.map((row) => row.state)).toEqual(["starting", "running"]);
  });

  it("stops a running container and recreates it", async () => {
    const { harness, container } = await boot();
    await harness.fetch(op("start", { origin: "https://gantree.example", bearer: "tok" }));
    const stopped = await read(await harness.fetch(op("stop")));
    expect(stopped.state).toBe("stopped");
    expect(container.signals).toEqual([15]);
    expect(container.running).toBe(false);

    const again = await read(await harness.fetch(op("recreate", { origin: "http://127.0.0.1:3000", bearer: "next" })));
    expect(again.state).toBe("running");
    expect(container.destroyed).toBe(1);
    expect(container.started).toHaveLength(2);
    expect(container.started[1]?.env?.PENDANT_MAILBOX_URL).toBe("ws://127.0.0.1:3000/ws/kit");
    expect(container.started[1]?.env?.PENDANT_BEARER).toBe("next");
  });

  it("returns failed instead of throwing", async () => {
    const { harness, container } = await boot();
    const missing = await read(await harness.fetch(op("start", {})));
    expect(missing).toMatchObject({ state: "failed", lastError: "no origin" });
    expect(container.started).toHaveLength(0);

    const bad = await read(await harness.fetch(op("nope")));
    expect(bad).toMatchObject({ state: "failed", lastError: "unknown op" });

    container.explode = true;
    const blew = await harness.fetch(op("start", { origin: "https://gantree.example", bearer: "tok" }));
    expect(blew.status).toBe(200);
    expect(await read(blew)).toMatchObject({ state: "failed", lastError: "no docker" });

    await expect(harness.onError(new Error("boom"))).resolves.toBeUndefined();
    expect(await read(await harness.fetch(op("info")))).toMatchObject({ state: "failed", lastError: "boom" });
  });

  it("still answers when storage put throws", async () => {
    const storage = new FakeStorage();
    storage.failPut = true;
    const { harness } = await boot("kit", storage);
    const res = await harness.fetch(op("start", { origin: "https://gantree.example", bearer: "tok" }));
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ state: "failed", lastError: "disk" });
  });

  it("records a non-zero exit as failed", async () => {
    const { harness } = await boot();
    await harness.onStop({ exitCode: 1, reason: "exit" });
    expect(await read(await harness.fetch(op("info")))).toMatchObject({ state: "failed", lastError: "exit 1" });
  });
});

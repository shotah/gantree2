/**
 * One Cloudflare Container per agent slug. The Worker drives it with
 * `X-Harness-Op` (`start` | `stop` | `recreate` | `info`).
 *
 * `harness/Dockerfile` has no EXPOSE and no HTTP healthcheck — `gantry` dials
 * the room and does not listen. `defaultPort` is 8080 so the Container class
 * has a probe port. `start()` (not `startAndWaitForPorts`) treats "not
 * listening" on that port as up.
 *
 * Process env is the dial-back only. LLM keys, mcp.toml, and persona arrive
 * later on the socket. The current `gantry` binary also requires
 * `PENDANT_ALLOWED_USERS` before it will stay up; that list is not in the
 * start body (the room lives on the Agent DO), so a real container exits
 * until the harness takes the room from the `config` frame.
 */
import { Container, type StopParams } from "@cloudflare/containers";
import type { ContainerInfo, ContainerState } from "@/lib/agents/types";
import type { AgentEnv } from "@/lib/chat/env";

/** Supervisor probe port. The harness does not bind it. */
export const HARNESS_PORT = 8080;

/** Image the wrangler binding builds (`containers[].image`). */
export const HARNESS_IMAGE = "./harness/Dockerfile";

const INFO_KEY = "container-info";

type StartSpec = { origin: string; bearer: string };

export function harnessProcessEnv(origin: string, slug: string, bearer: string): Record<string, string> {
  const url = new URL(origin);
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
  url.pathname = `/ws/${encodeURIComponent(slug)}`;
  url.search = "";
  url.hash = "";
  return {
    CHANNEL: "pendant",
    PENDANT_MAILBOX_URL: url.toString(),
    PENDANT_BEARER: bearer,
    SNAPSHOT: "true",
    SNAPSHOT_INTERVAL: "5m",
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "error";
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "error";
}

function json(body: ContainerInfo): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

export class Harness extends Container<AgentEnv> {
  defaultPort = HARNESS_PORT;
  sleepAfter = "2h";

  async fetch(request: Request): Promise<Response> {
    try {
      return json(await this.dispatch(request));
    } catch (error) {
      return json(await this.markFailed(error));
    }
  }

  override async onStart(): Promise<void> {
    const prev = await this.ctx.storage.get<ContainerInfo>(INFO_KEY);
    await this.ctx.storage.put(INFO_KEY, {
      state: "running",
      since: Date.now(),
      lastError: null,
      image: prev?.image ?? HARNESS_IMAGE,
    } satisfies ContainerInfo);
  }

  override async onStop(params: StopParams): Promise<void> {
    const prev = await this.ctx.storage.get<ContainerInfo>(INFO_KEY);
    const crashed = params.exitCode !== 0;
    await this.ctx.storage.put(INFO_KEY, {
      state: crashed ? "failed" : "stopped",
      since: Date.now(),
      lastError: crashed ? `exit ${params.exitCode}` : null,
      image: prev?.image ?? HARNESS_IMAGE,
    } satisfies ContainerInfo);
  }

  override async onError(error: unknown): Promise<void> {
    await this.markFailed(error);
  }

  private async dispatch(request: Request): Promise<ContainerInfo> {
    const op = request.headers.get("X-Harness-Op");
    if (op === "info") {
      return this.readInfo();
    }
    if (op === "stop") {
      return this.halt();
    }
    if (op === "start") {
      return this.begin(await readSpec(request));
    }
    if (op === "recreate") {
      return this.recreate(await readSpec(request));
    }
    return this.markFailed("unknown op");
  }

  private async begin(spec: StartSpec | string): Promise<ContainerInfo> {
    if (typeof spec === "string") {
      return this.markFailed(spec);
    }
    const slug = this.ctx.id.name;
    if (!slug) {
      return this.markFailed("no slug");
    }
    let envVars: Record<string, string>;
    try {
      envVars = harnessProcessEnv(spec.origin, slug, spec.bearer);
    } catch (error) {
      return this.markFailed(error);
    }
    this.envVars = envVars;
    await this.ctx.storage.put(INFO_KEY, {
      state: "starting",
      since: Date.now(),
      lastError: null,
      image: HARNESS_IMAGE,
    } satisfies ContainerInfo);
    try {
      await this.start({ envVars, enableInternet: true });
    } catch (error) {
      return this.markFailed(error);
    }
    return this.readInfo();
  }

  private async halt(): Promise<ContainerInfo> {
    const prev = await this.readInfo();
    if (!this.ctx.container?.running) {
      return this.save({
        state: "stopped",
        since: prev.state === "stopped" ? prev.since : Date.now(),
        lastError: null,
        image: prev.image,
      });
    }
    await this.save({
      state: "stopping",
      since: Date.now(),
      lastError: null,
      image: prev.image ?? HARNESS_IMAGE,
    });
    try {
      await this.stop();
    } catch (error) {
      return this.markFailed(error);
    }
    return this.readInfo();
  }

  /** stop + destroy, then start. A failed stop or destroy does not start. */
  private async recreate(spec: StartSpec | string): Promise<ContainerInfo> {
    const stopped = await this.halt();
    if (stopped.state === "failed") {
      return stopped;
    }
    try {
      await this.destroy();
    } catch (error) {
      return this.markFailed(error);
    }
    return this.begin(spec);
  }

  private async readInfo(): Promise<ContainerInfo> {
    const stored = await this.ctx.storage.get<ContainerInfo>(INFO_KEY);
    if (stored && isInfo(stored)) {
      return stored;
    }
    const running = this.ctx.container?.running === true;
    return {
      state: running ? "running" : "stopped",
      since: null,
      lastError: null,
      image: null,
    };
  }

  private async save(info: ContainerInfo): Promise<ContainerInfo> {
    await this.ctx.storage.put(INFO_KEY, info);
    return info;
  }

  private async markFailed(error: unknown): Promise<ContainerInfo> {
    const info: ContainerInfo = {
      state: "failed",
      since: Date.now(),
      lastError: errorText(error).slice(0, 500),
      image: HARNESS_IMAGE,
    };
    try {
      const prev = await this.ctx.storage.get<ContainerInfo>(INFO_KEY);
      if (prev && isInfo(prev) && prev.image) {
        info.image = prev.image;
      }
      await this.ctx.storage.put(INFO_KEY, info);
    } catch {
      // The caller still returns `info`. A storage miss must not escape.
    }
    return info;
  }
}

const STATES = new Set<ContainerState>(["stopped", "starting", "running", "stopping", "failed", "unknown"]);

function isInfo(value: unknown): value is ContainerInfo {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as ContainerInfo;
  return STATES.has(row.state);
}

async function readSpec(request: Request): Promise<StartSpec | string> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return "bad body";
  }
  if (!value || typeof value !== "object") {
    return "bad body";
  }
  const origin = (value as { origin?: unknown }).origin;
  const bearer = (value as { bearer?: unknown }).bearer;
  if (typeof origin !== "string" || !origin.trim()) {
    return "no origin";
  }
  if (typeof bearer !== "string" || !bearer) {
    return "no bearer";
  }
  return { origin: origin.trim(), bearer };
}

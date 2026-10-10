/**
 * Container lifecycle for one agent — the Harness Durable Object behind the
 * `HARNESS` binding. One object per slug (`idFromName(slug)`).
 *
 * Missing `HARNESS` (local dev without containers) is `unknown`, never a throw.
 * `start` / `recreate` read the room bearer from the Agent DO and pass
 * `{ origin, bearer }` to the harness. Origin is `env.PUBLIC_ORIGIN` when set,
 * otherwise the optional `origin` argument (the HTTP route passes the request).
 */
import { fetchRoomBearer } from "@/lib/chat/bearer";
import { agentStub } from "@/lib/chat/location";
import type { AgentsEnv, ContainerAction, ContainerInfo, ContainerState } from "./types";

export const UNKNOWN_CONTAINER: ContainerInfo = { state: "unknown", since: null, lastError: null, image: null };

const STATES = new Set<ContainerState>(["stopped", "starting", "running", "stopping", "failed", "unknown"]);

type OriginEnv = AgentsEnv & { PUBLIC_ORIGIN?: string };

export async function containerInfo(env: AgentsEnv, slug: string): Promise<ContainerInfo> {
  if (!env.HARNESS) {
    return UNKNOWN_CONTAINER;
  }
  try {
    return await harnessOp(env, slug, "info");
  } catch (error) {
    return failed(errorText(error));
  }
}

export async function containerAct(
  env: AgentsEnv,
  slug: string,
  action: ContainerAction,
  origin?: string,
): Promise<ContainerInfo> {
  if (!env.HARNESS) {
    return UNKNOWN_CONTAINER;
  }
  try {
    if (action.action === "stop") {
      return await harnessOp(env, slug, "stop");
    }
    if (action.action !== "start" && action.action !== "recreate") {
      return failed("bad action");
    }
    const dial = resolveOrigin(env, origin);
    if (!dial) {
      return failed("no origin");
    }
    const agent = agentStub(env, slug);
    const bearer = agent ? await fetchRoomBearer(agent) : null;
    if (!bearer) {
      return failed("no bearer");
    }
    const info = await harnessOp(env, slug, action.action, { origin: dial, bearer });
    if (info.state === "starting" || info.state === "running") {
      await noteStarted(env, slug);
    }
    return info;
  } catch (error) {
    return failed(errorText(error));
  }
}

/**
 * `PUBLIC_ORIGIN` wins. Empty means the fallback (request origin). A set but
 * unusable value fails closed — it does not silently dial the browser host.
 */
export function resolveOrigin(env: AgentsEnv, fallback?: string): string | null {
  const configured = (env as OriginEnv).PUBLIC_ORIGIN;
  const prefer = typeof configured === "string" ? configured.trim() : "";
  const raw = prefer || fallback?.trim() || "";
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

async function harnessOp(env: AgentsEnv, slug: string, op: string, body?: { origin: string; bearer: string }): Promise<ContainerInfo> {
  const ns = env.HARNESS;
  if (!ns) {
    return UNKNOWN_CONTAINER;
  }
  const res = await ns.get(ns.idFromName(slug)).fetch(new Request(`https://harness/${op}`, {
    method: body ? "POST" : "GET",
    headers: {
      "X-Harness-Op": op,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }));
  return readInfo(res);
}

/**
 * Tell the Agent DO the container came up so it can push a `config` frame.
 * Unknown ops are 426 today and 404 once the handler exists but misses.
 * Either way the container is already up — ignore the miss.
 */
async function noteStarted(env: AgentsEnv, slug: string): Promise<void> {
  const agent = agentStub(env, slug);
  if (!agent) {
    return;
  }
  try {
    const res = await agent.fetch(new Request("https://agent/config", {
      method: "POST",
      headers: { "X-Chat-Op": "config", "content-type": "application/json" },
      body: JSON.stringify({ started: true }),
    }));
    void res.body?.cancel();
  } catch {
    // best-effort
  }
}

async function readInfo(res: Response): Promise<ContainerInfo> {
  try {
    const body: unknown = await res.json();
    if (isInfo(body)) {
      return body;
    }
  } catch {
    // fall through
  }
  return failed(`harness ${res.status}`);
}

function isInfo(value: unknown): value is ContainerInfo {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as ContainerInfo;
  return STATES.has(row.state)
    && (row.since === null || typeof row.since === "number")
    && (row.lastError === null || typeof row.lastError === "string")
    && (row.image === null || typeof row.image === "string");
}

function failed(lastError: string): ContainerInfo {
  return { state: "failed", since: Date.now(), lastError, image: null };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "error";
  }
  return "error";
}

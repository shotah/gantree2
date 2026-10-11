/**
 * `GET` / `POST /api/agents/:slug/container`. Role gate is the principal
 * middleware stamped on the request (`canRunAgent`: admin, or operator of
 * this slug). Logic stays here so the route file is a shell.
 */
import { agentStub } from "@/lib/chat/location";
import { principalFromHeaders } from "@/lib/door/gate";
import { canRunAgent } from "@/lib/door/users";
import { containerAct, containerInfo } from "./container";
import { AGENT_SLUG, type AgentsEnv, type ContainerAction, type ContainerInfo } from "./types";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function normalizeSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  return AGENT_SLUG.test(slug) ? slug : null;
}

/** A `Response` when the caller may not proceed; otherwise the slug. */
function admit(request: Request, raw: string): Response | string {
  const who = principalFromHeaders(request.headers);
  if (!who) {
    return json({ error: "forbidden" }, 403);
  }
  const slug = normalizeSlug(raw);
  if (!slug) {
    return json({ error: "bad slug" }, 400);
  }
  if (!canRunAgent(who, slug)) {
    return json({ error: "forbidden" }, 403);
  }
  return slug;
}

export async function getContainer(request: Request, env: AgentsEnv, slug: string): Promise<Response> {
  const name = admit(request, slug);
  if (name instanceof Response) {
    return name;
  }
  return json(await containerInfo(env, name));
}

export async function postContainer(request: Request, env: AgentsEnv, slug: string): Promise<Response> {
  const name = admit(request, slug);
  if (name instanceof Response) {
    return name;
  }
  const action = await readAction(request);
  if (action instanceof Response) {
    return action;
  }
  if (await nativeRuntime(env, name)) {
    return json(nativeRefusal());
  }
  const origin = new URL(request.url).origin;
  return json(await containerAct(env, name, action, origin));
}

/** The harness is not this agent's runtime. Callers of `containerAct` stop here. */
function nativeRefusal(): ContainerInfo {
  return { state: "failed", since: Date.now(), lastError: "native runtime", image: null };
}

async function nativeRuntime(env: AgentsEnv, slug: string): Promise<boolean> {
  const agent = agentStub(env, slug);
  if (!agent) {
    return false;
  }
  try {
    const res = await agent.fetch(new Request("https://agent/config", {
      headers: { "X-Chat-Op": "config" },
    }));
    if (!res.ok) {
      return false;
    }
    const body: unknown = await res.json();
    return Boolean(body && typeof body === "object" && (body as { runtime?: unknown }).runtime === "native");
  } catch {
    return false;
  }
}

async function readAction(request: Request): Promise<ContainerAction | Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return json({ error: "bad json" }, 400);
  }
  const action = (value as { action?: unknown }).action;
  if (action !== "start" && action !== "stop" && action !== "recreate") {
    return json({ error: "bad action" }, 400);
  }
  return { action };
}

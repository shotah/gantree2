/**
 * `/api/agents` and `/api/samples` as HTTP. Role gate, then the Settings DO
 * for inventory and the Agent DO for the room. Snapshot URLs carry no cookie.
 */
import { containerAct, containerInfo, UNKNOWN_CONTAINER } from "@/lib/agents/container";
import {
  normalizeSlug,
  type AgentCreateBody,
  type AgentDelete,
  type AgentWrite,
} from "@/lib/agents/registry";
import {
  isSnapshotFile,
  readSnapshot,
  SNAPSHOT_CONTENT_TYPE,
  snapshotTooBig,
  type SnapshotStore,
  verifySnapshot,
  writeSnapshot,
} from "@/lib/agents/snapshot";
import { isAgentStatus } from "@/lib/agents/status";
import type { AgentCard, AgentRow, AgentStatus, AgentsEnv, ContainerInfo } from "@/lib/agents/types";
import { fetchRoomBearer } from "@/lib/chat/bearer";
import { randomToken } from "@/lib/door/google";
import { agentStub } from "@/lib/chat/location";
import { fromStub } from "@/lib/chat/slugRoute";
import { principalFromHeaders, type Principal } from "@/lib/door/gate";
import { json } from "@/lib/door/http";
import type { SampleQuery, SampleRow } from "@/lib/door/settingsStore";
import { canRunAgent } from "@/lib/door/users";

export type AgentsHttpEnv = AgentsEnv & {
  LOCATION_HINT?: string;
};

const SETTINGS_NAME = "settings";
const SAMPLE_LIMIT = 200;

type SettingsApi = {
  listAgents(): Promise<AgentRow[]>;
  getAgent(slug: string): Promise<AgentRow | null>;
  createAgent(input: AgentCreateBody, actor: string): Promise<AgentWrite>;
  deleteAgent(slug: string, actor: string): Promise<AgentDelete>;
  listSamples(query?: SampleQuery): Promise<SampleRow[]>;
};

type SettingsNamespace = {
  getByName?: (name: string) => SettingsApi;
  idFromName?: (name: string) => { toString(): string };
  get?: (id: { toString(): string }) => SettingsApi;
};

export function fromDoor(env: object): AgentsHttpEnv {
  return env;
}

export function settingsApi(env: AgentsEnv): SettingsApi | null {
  const ns = env.SETTINGS as SettingsNamespace | undefined;
  if (!ns || typeof ns !== "object") {
    return null;
  }
  if (typeof ns.getByName === "function") {
    return ns.getByName(SETTINGS_NAME);
  }
  if (typeof ns.idFromName === "function" && typeof ns.get === "function") {
    return ns.get(ns.idFromName(SETTINGS_NAME));
  }
  return null;
}

function authorize(req: Request): Principal | Response {
  const who = principalFromHeaders(req.headers);
  if (!who) {
    return json({ error: "unauthorized" }, 401);
  }
  if (who.role === "member") {
    return json({ error: "forbidden" }, 403);
  }
  return who;
}

function isResponse(value: Principal | Response): value is Response {
  return value instanceof Response;
}

function requireAdmin(who: Principal): Response | null {
  if (who.role !== "admin") {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}

function requireRun(who: Principal, slug: string): Response | null {
  if (!canRunAgent(who, slug)) {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await req.json<unknown>();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readStatus(env: AgentsHttpEnv, slug: string): Promise<AgentStatus | null> {
  try {
    const stub = agentStub(env, slug);
    if (!stub) {
      return null;
    }
    const res = await stub.fetch(new Request("https://agent/status", {
      headers: { "X-Chat-Op": "status" },
    }));
    if (!res.ok) {
      return null;
    }
    const body: unknown = await res.json();
    return isAgentStatus(body) ? body : null;
  } catch {
    return null;
  }
}

async function readContainer(env: AgentsHttpEnv, slug: string): Promise<ContainerInfo> {
  try {
    return await containerInfo(env, slug);
  } catch {
    return UNKNOWN_CONTAINER;
  }
}

async function cardFor(env: AgentsHttpEnv, who: Principal, row: AgentRow): Promise<AgentCard> {
  const [status, container] = await Promise.all([
    readStatus(env, row.slug),
    readContainer(env, row.slug),
  ]);
  return { ...row, status, container, canMutate: canRunAgent(who, row.slug) };
}

async function callAgent(env: AgentsHttpEnv, slug: string, url: string, init?: RequestInit): Promise<Response> {
  try {
    const stub = agentStub(env, slug);
    if (!stub) {
      return json({ error: "agent_unavailable" }, 503);
    }
    return fromStub(await stub.fetch(new Request(url, init)));
  } catch {
    return json({ error: "agent_unavailable" }, 503);
  }
}

function slugOr400(raw: string): string | Response {
  const slug = normalizeSlug(raw);
  if (!slug) {
    return json({ error: "bad_slug" }, 400);
  }
  return slug;
}

export async function getAgents(req: Request, env: AgentsHttpEnv): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  try {
    const rows = await api.listAgents();
    const visible = who.role === "admin" ? rows : rows.filter((row) => canRunAgent(who, row.slug));
    const agents = await Promise.all(visible.map((row) => cardFor(env, who, row)));
    return json({ agents });
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
}

export async function postAgent(req: Request, env: AgentsHttpEnv): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const admin = requireAdmin(who);
  if (admin) {
    return admin;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  const body = await readJson(req);
  if (!body) {
    return json({ error: "bad_json" }, 400);
  }
  let outcome: AgentWrite;
  try {
    outcome = await api.createAgent({ slug: body.slug, name: body.name, tags: body.tags }, who.sub);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (!outcome.ok) {
    const status = outcome.error === "exists" ? 409 : 400;
    return json({ error: outcome.error }, status);
  }
  await mintBearer(env, outcome.agent.slug);
  return json({ agent: await cardFor(env, who, outcome.agent) }, 201);
}

/**
 * A new room gets its bearer at birth, so the `config` frame can sign snapshot
 * URLs and the container start has a token to hand the harness. Keeps an
 * existing one (a re-create after delete). Best effort: a room without the
 * AGENT binding (local dev) is still created.
 */
async function mintBearer(env: AgentsHttpEnv, slug: string): Promise<void> {
  try {
    const stub = agentStub(env, slug);
    if (!stub || await fetchRoomBearer(stub)) {
      return;
    }
    await stub.fetch(new Request("https://agent/bearer", {
      method: "PUT",
      headers: { "X-Chat-Op": "bearer", "content-type": "application/json" },
      body: JSON.stringify({ bearer: randomToken() }),
    }));
  } catch {
    // The room is still listed; the bearer can be minted on first container start.
  }
}

export async function getAgent(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  try {
    const row = await api.getAgent(slug);
    if (!row) {
      return json({ error: "not_found" }, 404);
    }
    return json({ agent: await cardFor(env, who, row) });
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
}

export async function deleteAgent(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const admin = requireAdmin(who);
  if (admin) {
    return admin;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  try {
    await containerAct(env, slug, { action: "stop" });
  } catch {
    return json({ error: "container_unavailable" }, 503);
  }
  let outcome: AgentDelete;
  try {
    outcome = await api.deleteAgent(slug, who.sub);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (!outcome.ok) {
    const status = outcome.error === "not_found" ? 404 : 400;
    return json({ error: outcome.error }, status);
  }
  return new Response(null, { status: 204 });
}

export async function getAgentConfig(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  return callAgent(env, slug, "https://agent/config", { headers: { "X-Chat-Op": "config" } });
}

export async function patchAgentConfig(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  const body = await req.text();
  return callAgent(env, slug, "https://agent/config", {
    method: "PATCH",
    headers: { "X-Chat-Op": "config", "content-type": "application/json" },
    body,
  });
}

export async function getAgentStatus(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  return callAgent(env, slug, "https://agent/status", { headers: { "X-Chat-Op": "status" } });
}

export async function getAgentLog(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  const after = new URL(req.url).searchParams.get("after");
  const url = after == null ? "https://agent/log" : `https://agent/log?after=${encodeURIComponent(after)}`;
  return callAgent(env, slug, url, { headers: { "X-Chat-Op": "log" } });
}

export async function getAgentUsers(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  return callAgent(env, slug, "https://agent/allow", { headers: { "X-Chat-Op": "allow" } });
}

export async function putAgentUsers(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const denied = requireRun(who, slug);
  if (denied) {
    return denied;
  }
  const body = await req.text();
  return callAgent(env, slug, "https://agent/allow", {
    method: "PUT",
    headers: { "X-Chat-Op": "allow", "content-type": "application/json" },
    body,
  });
}

function parseSince(raw: string | null): number | null | "bad" {
  if (raw == null || raw === "") {
    return null;
  }
  if (!/^-?[0-9]+$/.test(raw)) {
    return "bad";
  }
  const since = Number(raw);
  if (!Number.isSafeInteger(since)) {
    return "bad";
  }
  return since;
}

export async function getSamples(req: Request, env: AgentsHttpEnv): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  const url = new URL(req.url);
  const since = parseSince(url.searchParams.get("since"));
  if (since === "bad") {
    return json({ error: "bad_since" }, 400);
  }
  const agentRaw = url.searchParams.get("agent");
  const agent = agentRaw == null || agentRaw.trim() === "" ? "" : normalizeSlug(agentRaw);
  if (agentRaw != null && agentRaw.trim() !== "" && !agent) {
    return json({ error: "bad_slug" }, 400);
  }
  if (agent && !canRunAgent(who, agent)) {
    return json({ error: "forbidden" }, 403);
  }
  const query: SampleQuery = { since: since ?? undefined, limit: SAMPLE_LIMIT };
  if (agent) {
    query.agent = agent;
  } else if (who.role !== "admin") {
    query.agents = who.agents;
  }
  try {
    const samples: SampleRow[] = await api.listSamples(query);
    return json({ samples });
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
}

export async function handleSnapshot(
  req: Request,
  env: AgentsHttpEnv,
  slugRaw: string,
  fileRaw: string,
  opts: { now?: number; maxBytes?: number } = {},
): Promise<Response> {
  if (req.method !== "GET" && req.method !== "PUT") {
    return new Response("method", { status: 405 });
  }
  const slug = normalizeSlug(slugRaw);
  const file = fileRaw;
  if (!slug || !isSnapshotFile(file)) {
    return new Response(null, { status: 404 });
  }
  const stub = agentStub(env, slug);
  if (!stub) {
    return json({ error: "agent_unavailable" }, 503);
  }
  const bearer = await fetchRoomBearer(stub);
  if (!bearer) {
    return json({ error: "unauthorized" }, 401);
  }
  const url = new URL(req.url);
  const exp = url.searchParams.get("exp") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const now = opts.now ?? Date.now();
  let ok: boolean;
  try {
    ok = await verifySnapshot(bearer, slug, file, req.method, exp, sig, now);
  } catch {
    ok = false;
  }
  if (!ok) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.STORE) {
    return json({ error: "store_unavailable" }, 503);
  }
  const store: SnapshotStore = env.STORE;
  const stamp = url.searchParams.get("stamp") ?? undefined;
  try {
    if (req.method === "GET") {
      const body = await readSnapshot(store, slug, file, stamp);
      if (!body) {
        return new Response(null, { status: 404 });
      }
      return new Response(body, {
        status: 200,
        headers: { "content-type": SNAPSHOT_CONTENT_TYPE, "cache-control": "no-store" },
      });
    }
    const bytes = await req.arrayBuffer();
    if (snapshotTooBig(bytes.byteLength, opts.maxBytes)) {
      return json({ error: "too_large" }, 413);
    }
    await writeSnapshot(store, slug, file, bytes, stamp);
    return new Response(null, { status: 204 });
  } catch {
    return json({ error: "store_unavailable" }, 503);
  }
}

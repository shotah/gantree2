/**
 * `/api/agents` and `/api/samples` as HTTP. Role gate, then the Settings DO
 * for inventory and the Agent DO for the room.
 */
import { oauthRedirectPlugin } from "@/lib/agents/oauth";
import {
  normalizeSlug,
  type AgentCreateBody,
  type AgentDelete,
  type AgentEnabledSet,
  type AgentWrite,
} from "@/lib/agents/registry";
import { isAgentStatus } from "@/lib/agents/status";
import type { AgentCard, AgentRow, AgentStatus, AgentsEnv } from "@/lib/agents/types";
import { fetchRoomBearer } from "@/lib/chat/bearer";
import { fetchRoomUsers } from "@/lib/chat/allow";
import { directoryApply } from "@/lib/chat/directory";
import { randomToken } from "@/lib/door/google";
import { memberInDirectory, memberRoomUsersWhenNeeded } from "@/lib/chat/admission";
import { phoneAdmitted } from "@/lib/chat/floor";
import { agentStub } from "@/lib/chat/location";
import { fromStub } from "@/lib/chat/slugRoute";
import { devIdentity, principalFromHeaders, type Principal } from "@/lib/door/gate";
import { json } from "@/lib/door/http";
import { canRunAgent } from "@/lib/door/users";
import type { DirectoryKv } from "@/lib/chat/directory";
import type { SampleQuery, SampleRow } from "@/lib/door/settingsStore";

export type AgentsHttpEnv = AgentsEnv & {
  DIRECTORY?: DirectoryKv;
  LOCATION_HINT?: string;
  /** Read by `getAgentBearer` only: the bearer route exists where the gate honours this. */
  GANTREE_DEV_USER?: string;
};

const SETTINGS_NAME = "settings";
const SAMPLE_LIMIT = 200;

type SettingsApi = {
  listAgents(): Promise<AgentRow[]>;
  getAgent(slug: string): Promise<AgentRow | null>;
  createAgent(input: AgentCreateBody, actor: string): Promise<AgentWrite>;
  deleteAgent(slug: string, actor: string): Promise<AgentDelete>;
  setAgentEnabled(slug: string, enabled: boolean, actor: string): Promise<AgentEnabledSet>;
  deleteSamplesForAgent(agent: string): Promise<void>;
  removeSlugFromOperators(slug: string): Promise<void>;
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

function authorizeSignedIn(req: Request): Principal | Response {
  const who = principalFromHeaders(req.headers);
  if (!who) {
    return json({ error: "unauthorized" }, 401);
  }
  return who;
}

function authorize(req: Request): Principal | Response {
  const who = authorizeSignedIn(req);
  if (isResponse(who)) {
    return who;
  }
  const admin = requireAdmin(who);
  if (admin) {
    return admin;
  }
  return who;
}

async function requireAgentControl(env: AgentsHttpEnv, who: Principal, slug: string): Promise<Response | null> {
  if (who.role === "admin") {
    return null;
  }
  if (who.role === "operator") {
    return who.agents.includes(slug) ? null : json({ error: "forbidden" }, 403);
  }
  const session = {
    sub: who.sub,
    email: who.email ?? undefined,
    emailVerified: Boolean(who.email),
  };
  const inDirectory = await memberInDirectory(env, session, slug);
  const roomList = await memberRoomUsersWhenNeeded(env, slug, "member", inDirectory);
  if (phoneAdmitted(roomList, session, env, {
    role: "member",
    assignedSlugs: who.agents,
    slug,
    inDirectory,
  })) {
    return null;
  }
  return json({ error: "forbidden" }, 403);
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

async function cardFor(env: AgentsHttpEnv, who: Principal, row: AgentRow): Promise<AgentCard> {
  const status = await readStatus(env, row.slug);
  return { ...row, status, canMutate: who.role === "admin" };
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
    const agents = await Promise.all(rows.map((row) => cardFor(env, who, row)));
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
    const status = outcome.error === "exists" || outcome.error === "name_exists" ? 409 : 400;
    return json({ error: outcome.error }, status);
  }
  await mintBearer(env, outcome.agent.slug);
  return json({ agent: await cardFor(env, who, outcome.agent) }, 201);
}

/**
 * A new room gets its bearer at birth so a crane socket and the chat face
 * have a token. Keeps an existing one (a re-create after delete). Best effort:
 * a room without the AGENT binding (local dev) is still created.
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
    // The room is still listed; the bearer can be minted on the next open.
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
  const who = authorizeSignedIn(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  let row: AgentRow | null;
  try {
    row = await api.getAgent(slug);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (!row) {
    return json({ error: "not_found" }, 404);
  }
  const denied = await requireAgentControl(env, who, slug);
  if (denied) {
    return denied;
  }
  const stub = agentStub(env, slug);
  let prevUsers: Awaited<ReturnType<typeof fetchRoomUsers>> = [];
  if (stub) {
    try {
      prevUsers = await fetchRoomUsers(stub);
    } catch {
      prevUsers = [];
    }
  }
  if (env.DIRECTORY) {
    try {
      await directoryApply(env.DIRECTORY, slug, prevUsers, []);
    } catch {
      // Missing KV or a stale index should not block destroy.
    }
  }
  try {
    await api.removeSlugFromOperators(slug);
    await api.deleteSamplesForAgent(slug);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (stub) {
    try {
      const wiped = await stub.fetch(new Request("https://agent/destroy", {
        method: "POST",
        headers: { "X-Chat-Op": "destroy" },
      }));
      if (!wiped.ok) {
        return json({ error: "destroy_failed" }, 503);
      }
    } catch {
      return json({ error: "destroy_failed" }, 503);
    }
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

export async function postAgentEnabled(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorizeSignedIn(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  let row: AgentRow | null;
  try {
    row = await api.getAgent(slug);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (!row) {
    return json({ error: "not_found" }, 404);
  }
  const denied = await requireAgentControl(env, who, slug);
  if (denied) {
    return denied;
  }
  const body = await readJson(req);
  if (!body || typeof body.enabled !== "boolean") {
    return json({ error: "bad_json" }, 400);
  }
  let outcome: AgentEnabledSet;
  try {
    outcome = await api.setAgentEnabled(slug, body.enabled, who.sub);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (!outcome.ok) {
    const status = outcome.error === "not_found" ? 404 : 400;
    return json({ error: outcome.error }, status);
  }
  if (!body.enabled) {
    const stub = agentStub(env, slug);
    if (stub) {
      try {
        await stub.fetch(new Request("https://agent/pause", {
          method: "POST",
          headers: { "X-Chat-Op": "pause" },
        }));
      } catch {
        // Row is off; the next open can pause again.
      }
    }
  }
  return json({ agent: await cardFor(env, who, outcome.agent) });
}

/**
 * `GET /api/agents/:slug/bearer` → `{ bearer }`. Room token for loopback
 * tooling that dials the agent socket. Admin, and only where
 * `GANTREE_DEV_USER` is honoured (set, and the request is loopback);
 * anywhere else the route is a 404, the same as a path that does not exist.
 */
export async function getAgentBearer(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  if (!devIdentity({ GANTREE_DEV_USER: env.GANTREE_DEV_USER }, new URL(req.url))) {
    return json({ error: "not_found" }, 404);
  }
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
  const stub = agentStub(env, slug);
  if (!stub) {
    return json({ error: "agent_unavailable" }, 503);
  }
  const bearer = await fetchRoomBearer(stub);
  if (!bearer) {
    return json({ error: "not_found" }, 404);
  }
  return json({ bearer });
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
  const body = await req.text();
  return callAgent(env, slug, "https://agent/config", {
    method: "PATCH",
    headers: { "X-Chat-Op": "config", "content-type": "application/json" },
    body,
  });
}

export async function getAgentSelf(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  return callAgent(env, slug, "https://agent/self", { headers: { "X-Chat-Op": "self_get" } });
}

export async function putAgentSelf(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const body = await req.text();
  return callAgent(env, slug, "https://agent/self", {
    method: "PUT",
    headers: { "X-Chat-Op": "self_put", "content-type": "application/json" },
    body,
  });
}

export async function getAgentPersona(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  return callAgent(env, slug, "https://agent/persona", { headers: { "X-Chat-Op": "persona_get" } });
}

export async function putAgentPersona(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const body = await req.text();
  return callAgent(env, slug, "https://agent/persona", {
    method: "PUT",
    headers: { "X-Chat-Op": "persona_put", "content-type": "application/json" },
    body,
  });
}

export async function startAgentAuth(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const body = await readJson(req);
  const plugin = typeof body?.plugin === "string" ? body.plugin.trim() : "";
  if (!oauthRedirectPlugin(plugin)) {
    return json({ error: "bad_plugin" }, 400);
  }
  let origin: string;
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = "";
  }
  return callAgent(env, slug, "https://agent/auth/start", {
    method: "POST",
    headers: { "X-Chat-Op": "auth_start", "content-type": "application/json" },
    body: JSON.stringify({ plugin, origin, slug }),
  });
}

export async function deleteAgentPersona(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const body = await req.text();
  return callAgent(env, slug, "https://agent/persona", {
    method: "DELETE",
    headers: { "X-Chat-Op": "persona_delete", "content-type": "application/json" },
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
  return callAgent(env, slug, "https://agent/status", { headers: { "X-Chat-Op": "status" } });
}

export async function postAgentRestart(req: Request, env: AgentsHttpEnv, slugRaw: string): Promise<Response> {
  const who = authorize(req);
  if (isResponse(who)) {
    return who;
  }
  const slug = slugOr400(slugRaw);
  if (slug instanceof Response) {
    return slug;
  }
  const api = settingsApi(env);
  if (!api) {
    return json({ error: "settings_unavailable" }, 503);
  }
  let row: AgentRow | null;
  try {
    row = await api.getAgent(slug);
  } catch {
    return json({ error: "settings_unavailable" }, 503);
  }
  if (!row) {
    return json({ error: "not_found" }, 404);
  }
  if (!row.enabled) {
    return json({ error: "off" }, 409);
  }
  return callAgent(env, slug, "https://agent/restart", {
    method: "POST",
    headers: { "X-Chat-Op": "restart" },
  });
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

import { api } from "@/app/lib/api";
import type { Role } from "@/lib/door/users";
import type { RoomUser } from "@/lib/chat/allow";
import type {
  AgentCard,
  AgentConfigPatch,
  AgentConfigView,
  AgentCreate,
  AgentStatus,
  LogPage,
  ToolEntry,
} from "@/lib/agents/types";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Session = {
  sub: string;
  email: string | null;
  role: Role;
  agents: string[];
};

export class AgentsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AgentsError";
    this.status = status;
    this.code = code;
  }
}

const COPY: Record<string, string> = {
  forbidden: "You do not have access to that.",
  not_found: "That agent is not here.",
  bad_persona: "Use a markdown file name like PERSONA.md.",
  too_long: "That persona is over the size limit.",
  empty: "SELF.md cannot be empty.",
  bad_self: "That self note was not valid.",
  bad_slug: "Use a letter, then lowercase letters, digits, or hyphens.",
  exists: "That agent ID is already in use.",
  name_exists: "That agent name is already in use.",
  bad_json: "That request was not valid JSON.",
  bad_body: "The agents service sent an unexpected reply.",
  request_failed: "Could not reach agents. Try again.",
  off: "This agent is stopped. Turn it on to chat or restart.",
  unauthorized: "Sign in again.",
  bad_plugin: "That tool does not connect from here.",
  no_origin: "This agent has no public address yet.",
  no_login: "That tool has no connect link.",
};

export function agentsMessage(code: string): string {
  return COPY[code] ?? code;
}

export function codeOf(err: unknown): string {
  return err instanceof AgentsError ? err.code : "request_failed";
}

export const ME_URL = "/api/auth/me";
export const TOOLS_URL = "/api/tools";

export function agentsUrl(): string {
  return "/api/agents";
}

export function agentUrl(slug: string): string {
  return `/api/agents/${encodeURIComponent(slug)}`;
}

export function configUrl(slug: string): string {
  return `${agentUrl(slug)}/config`;
}

export function selfUrl(slug: string): string {
  return `${agentUrl(slug)}/self`;
}

export function personaUrl(slug: string): string {
  return `${agentUrl(slug)}/persona`;
}

export function statusUrl(slug: string): string {
  return `${agentUrl(slug)}/status`;
}

export function restartUrl(slug: string): string {
  return `${agentUrl(slug)}/restart`;
}

export function enabledUrl(slug: string): string {
  return `${agentUrl(slug)}/enabled`;
}

export function logUrl(slug: string, after?: number): string {
  const base = `${agentUrl(slug)}/log`;
  return after === undefined ? base : `${base}?after=${after}`;
}

export function usersUrl(slug: string): string {
  return `${agentUrl(slug)}/users`;
}

export function cloneUrl(sourceSlug: string): string {
  return `${agentUrl(sourceSlug)}/clone`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bad(): never {
  throw new AgentsError(200, "bad_body");
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "operator" || value === "member";
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Not JSON.
  }
  return "request_failed";
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

async function send(client: ApiClient, input: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await client(input, init);
  } catch {
    throw new AgentsError(0, "request_failed");
  }
  if (!res.ok) {
    throw new AgentsError(res.status, await errorCode(res));
  }
  if (res.status === 204) {
    return null;
  }
  try {
    const parsed: unknown = await res.json();
    return parsed;
  } catch {
    throw new AgentsError(res.status, "bad_body");
  }
}

function asCardRecord(item: unknown): AgentCard {
  if (!isRecord(item) || typeof item.slug !== "string" || typeof item.name !== "string" || !Array.isArray(item.tags)) {
    bad();
  }
  return item as AgentCard;
}

function asCards(body: unknown): AgentCard[] {
  if (!isRecord(body) || !Array.isArray(body.agents)) {
    bad();
  }
  return body.agents.map((item) => asCardRecord(item));
}

function asCard(body: unknown): AgentCard {
  if (!isRecord(body)) {
    bad();
  }
  return asCardRecord(body.agent);
}

function asConfig(body: unknown): AgentConfigView {
  if (
    !isRecord(body)
    || !Array.isArray(body.envKeys)
    || typeof body.mcp !== "string"
    || typeof body.persona !== "string"
    || typeof body.recreate !== "boolean"
    || ("idleHours" in body && typeof body.idleHours !== "number")
  ) {
    bad();
  }
  return body as AgentConfigView;
}

const BRAIN_STATES = new Set(["ready", "needs_keys", "error", "starting"]);

function asStatus(body: unknown): AgentStatus {
  if (
    !isRecord(body)
    || typeof body.state !== "string"
    || !BRAIN_STATES.has(body.state)
    || !Array.isArray(body.plugins)
  ) {
    bad();
  }
  return body as AgentStatus;
}

function asLog(body: unknown): LogPage {
  if (!isRecord(body) || !Array.isArray(body.lines) || typeof body.next !== "number") {
    bad();
  }
  return body as LogPage;
}

function asUsers(body: unknown): RoomUser[] {
  if (!isRecord(body) || !Array.isArray(body.users)) {
    bad();
  }
  return body.users as RoomUser[];
}

/** `GET /api/tools`: the baked catalog plus the key names the Worker env supplies to every agent. */
export type ToolsPage = { tools: ToolEntry[]; house: string[] };

function asTools(body: unknown): ToolsPage {
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    bad();
  }
  const house = Array.isArray(body.house) ? body.house.filter((key): key is string => typeof key === "string") : [];
  return { tools: body.tools as ToolEntry[], house };
}

function asSession(body: unknown): Session {
  if (!isRecord(body) || typeof body.sub !== "string" || !isRole(body.role) || !Array.isArray(body.agents)) {
    bad();
  }
  return {
    sub: body.sub,
    email: typeof body.email === "string" ? body.email : null,
    role: body.role,
    agents: body.agents.filter((item): item is string => typeof item === "string"),
  };
}

export async function getMe(client: ApiClient = api): Promise<Session> {
  return asSession(await send(client, ME_URL, { method: "GET" }));
}

export async function listAgents(client: ApiClient = api): Promise<AgentCard[]> {
  return asCards(await send(client, agentsUrl(), { method: "GET" }));
}

export async function getAgent(slug: string, client: ApiClient = api): Promise<AgentCard> {
  return asCard(await send(client, agentUrl(slug), { method: "GET" }));
}

export async function createAgent(body: AgentCreate, client: ApiClient = api): Promise<AgentCard> {
  return asCard(await send(client, agentsUrl(), jsonInit("POST", body)));
}

export async function cloneAgent(
  sourceSlug: string,
  body: { slug: string; name?: string; memories?: boolean },
  client: ApiClient = api,
): Promise<AgentCard> {
  return asCard(await send(client, cloneUrl(sourceSlug), jsonInit("POST", body)));
}

export async function deleteAgent(slug: string, client: ApiClient = api): Promise<void> {
  await send(client, agentUrl(slug), { method: "DELETE" });
}

export async function getAgentEnabled(slug: string, client: ApiClient = api): Promise<boolean> {
  const body = await send(client, enabledUrl(slug), { method: "GET" });
  if (!isRecord(body) || typeof body.enabled !== "boolean") {
    bad();
  }
  return body.enabled;
}

export async function setAgentEnabled(slug: string, enabled: boolean, client: ApiClient = api): Promise<AgentCard> {
  return asCard(await send(client, enabledUrl(slug), jsonInit("POST", { enabled })));
}

export async function getConfig(slug: string, client: ApiClient = api): Promise<AgentConfigView> {
  return asConfig(await send(client, configUrl(slug), { method: "GET" }));
}

export async function patchConfig(slug: string, patch: AgentConfigPatch, client: ApiClient = api): Promise<AgentConfigView> {
  return asConfig(await send(client, configUrl(slug), jsonInit("PATCH", patch)));
}

export type SelfNote = { text: string; maxChars: number };

function asSelf(body: unknown): SelfNote {
  if (!isRecord(body) || typeof body.text !== "string" || typeof body.maxChars !== "number" || !Number.isFinite(body.maxChars)) {
    bad();
  }
  return { text: body.text, maxChars: body.maxChars };
}

export async function getSelf(slug: string, client: ApiClient = api): Promise<SelfNote> {
  return asSelf(await send(client, selfUrl(slug), { method: "GET" }));
}

export async function putSelf(slug: string, text: string, client: ApiClient = api): Promise<SelfNote> {
  return asSelf(await send(client, selfUrl(slug), jsonInit("PUT", { text })));
}

export async function startAuth(slug: string, plugin: string, client: ApiClient = api): Promise<{ url: string }> {
  const body = await send(client, `${agentUrl(slug)}/auth/start`, jsonInit("POST", { plugin }));
  if (!isRecord(body) || typeof body.url !== "string" || body.url.length === 0) {
    bad();
  }
  return { url: body.url };
}

export type PersonaFile = { name: string; text: string; updatedAt: number };

export type PersonaPage = { files: PersonaFile[]; maxChars: number };

const PERSONA_FILE = "PERSONA.md";

function asPersona(body: unknown): PersonaPage {
  if (!isRecord(body) || !Array.isArray(body.files) || typeof body.maxChars !== "number" || !Number.isFinite(body.maxChars)) {
    bad();
  }
  const files: PersonaFile[] = [];
  for (const item of body.files) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.text !== "string" || typeof item.updatedAt !== "number") {
      bad();
    }
    files.push({ name: item.name, text: item.text, updatedAt: item.updatedAt });
  }
  return { files, maxChars: body.maxChars };
}

export async function getPersona(slug: string, client: ApiClient = api): Promise<PersonaPage> {
  return asPersona(await send(client, personaUrl(slug), { method: "GET" }));
}

export async function putPersona(slug: string, text: string, client: ApiClient = api): Promise<PersonaPage> {
  return asPersona(await send(client, personaUrl(slug), jsonInit("PUT", { name: PERSONA_FILE, text })));
}

export async function deletePersona(slug: string, client: ApiClient = api): Promise<PersonaPage> {
  return asPersona(await send(client, personaUrl(slug), jsonInit("DELETE", { name: PERSONA_FILE })));
}

export async function getStatus(slug: string, client: ApiClient = api): Promise<AgentStatus> {
  return asStatus(await send(client, statusUrl(slug), { method: "GET" }));
}

export async function restartAgent(slug: string, client: ApiClient = api): Promise<AgentStatus> {
  return asStatus(await send(client, restartUrl(slug), { method: "POST" }));
}

export async function getLog(slug: string, after?: number, client: ApiClient = api): Promise<LogPage> {
  return asLog(await send(client, logUrl(slug, after), { method: "GET" }));
}

export async function getRoomUsers(slug: string, client: ApiClient = api): Promise<RoomUser[]> {
  return asUsers(await send(client, usersUrl(slug), { method: "GET" }));
}

export async function putRoomUsers(slug: string, users: RoomUser[], client: ApiClient = api): Promise<RoomUser[]> {
  return asUsers(await send(client, usersUrl(slug), jsonInit("PUT", { users })));
}

export async function toolsPage(client: ApiClient = api): Promise<ToolsPage> {
  return asTools(await send(client, TOOLS_URL, { method: "GET" }));
}

export async function listTools(client: ApiClient = api): Promise<ToolEntry[]> {
  return (await toolsPage(client)).tools;
}

import { api } from "@/app/lib/api";
import type { Role } from "@/lib/door/users";
import type { RoomUser } from "@/lib/chat/allow";
import type {
  AgentCard,
  AgentConfigPatch,
  AgentConfigView,
  AgentCreate,
  AgentStatus,
  ContainerAction,
  ContainerInfo,
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
  bad_slug: "Use a letter, then lowercase letters, digits, or hyphens.",
  bad_json: "That request was not valid JSON.",
  bad_body: "The agents service sent an unexpected reply.",
  request_failed: "Could not reach agents. Try again.",
  unauthorized: "Sign in again.",
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

export function statusUrl(slug: string): string {
  return `${agentUrl(slug)}/status`;
}

export function logUrl(slug: string, after?: number): string {
  const base = `${agentUrl(slug)}/log`;
  return after === undefined ? base : `${base}?after=${after}`;
}

export function usersUrl(slug: string): string {
  return `${agentUrl(slug)}/users`;
}

export function containerUrl(slug: string): string {
  return `${agentUrl(slug)}/container`;
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
  ) {
    bad();
  }
  return body as AgentConfigView;
}

function asStatus(body: unknown): AgentStatus {
  if (
    !isRecord(body)
    || (body.harness !== "connected" && body.harness !== "disconnected")
    || !Array.isArray(body.published)
    || !Array.isArray(body.skipped)
  ) {
    bad();
  }
  return body as AgentStatus;
}

const CONTAINER_STATES = new Set(["stopped", "starting", "running", "stopping", "failed", "unknown"]);

function asContainer(body: unknown): ContainerInfo {
  if (!isRecord(body) || typeof body.state !== "string" || !CONTAINER_STATES.has(body.state)) {
    bad();
  }
  return body as ContainerInfo;
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

function asTools(body: unknown): ToolEntry[] {
  if (!isRecord(body) || !Array.isArray(body.tools)) {
    bad();
  }
  return body.tools as ToolEntry[];
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

export async function deleteAgent(slug: string, client: ApiClient = api): Promise<void> {
  await send(client, agentUrl(slug), { method: "DELETE" });
}

export async function getConfig(slug: string, client: ApiClient = api): Promise<AgentConfigView> {
  return asConfig(await send(client, configUrl(slug), { method: "GET" }));
}

export async function patchConfig(slug: string, patch: AgentConfigPatch, client: ApiClient = api): Promise<AgentConfigView> {
  return asConfig(await send(client, configUrl(slug), jsonInit("PATCH", patch)));
}

export async function getStatus(slug: string, client: ApiClient = api): Promise<AgentStatus> {
  return asStatus(await send(client, statusUrl(slug), { method: "GET" }));
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

export async function getContainer(slug: string, client: ApiClient = api): Promise<ContainerInfo> {
  return asContainer(await send(client, containerUrl(slug), { method: "GET" }));
}

export async function actContainer(
  slug: string,
  action: ContainerAction["action"],
  client: ApiClient = api,
): Promise<ContainerInfo> {
  return asContainer(await send(client, containerUrl(slug), jsonInit("POST", { action } satisfies ContainerAction)));
}

export async function listTools(client: ApiClient = api): Promise<ToolEntry[]> {
  return asTools(await send(client, TOOLS_URL, { method: "GET" }));
}

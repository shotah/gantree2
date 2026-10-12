import { settingsApi } from "@/lib/agents/http";
import type { AgentRow } from "@/lib/agents/types";
import { devIdentity, principalFromHeaders, type GateEnv } from "@/lib/door/gate";
import { resolveUser, type Resolved, type Role, type UserStore } from "@/lib/door/users";
import { fetchRoomUsers, type RoomUser } from "./allow";
import { agentsFor } from "./directory";
import type { AgentEnv } from "./env";
import { agentStub } from "./location";
import { readChatSession } from "./session";
import type { RoomSession } from "./room";

export async function slugInInventory(env: AgentEnv, slug: string): Promise<boolean> {
  const row = await inventoriedAgent(env, slug);
  return row != null;
}

/** Settings inventory row, or null when missing or settings is down. */
export async function inventoriedAgent(env: AgentEnv, slug: string): Promise<AgentRow | null> {
  const api = settingsApi(env);
  if (!api) {
    return null;
  }
  try {
    return await api.getAgent(slug);
  } catch {
    return null;
  }
}

export async function inventorySlugs(env: AgentEnv): Promise<string[]> {
  const api = settingsApi(env);
  if (!api) {
    return [];
  }
  try {
    const rows = await api.listAgents();
    return rows.map((row) => row.slug).filter(Boolean).sort();
  } catch {
    return [];
  }
}

export async function memberInDirectory(env: AgentEnv, session: RoomSession, slug: string): Promise<boolean> {
  if (!env.DIRECTORY) {
    return false;
  }
  const slugs = await agentsFor(env.DIRECTORY, session.sub, session.email);
  return slugs.includes(slug);
}

export type HumanChatVerdict = "ok" | "forbidden";

/** Whether this human may chat with the slug before loading the Agent DO room list. */
export function humanChatPrecheck(
  _env: AgentEnv,
  who: Pick<Resolved, "role" | "agents">,
  slug: string,
  _session: RoomSession,
): HumanChatVerdict {
  if (who.role === "admin") {
    return "ok";
  }
  if (who.role === "operator") {
    return who.agents.includes(slug) ? "ok" : "forbidden";
  }
  return "ok";
}

/** Member assignment when DIRECTORY missed: read the Agent DO allow list (inventory already checked). */
export async function memberRoomUsersWhenNeeded(
  env: AgentEnv,
  slug: string,
  role: Role,
  inDirectory: boolean,
): Promise<readonly RoomUser[]> {
  if (role !== "member" || inDirectory) {
    return [];
  }
  const stub = agentStub(env, slug);
  if (!stub) {
    return [];
  }
  return fetchRoomUsers(stub);
}

export async function doorUserForRequest(
  env: AgentEnv & GateEnv,
  req: Request,
  store: UserStore,
  now = Date.now(),
): Promise<Resolved | null> {
  const fromHeaders = principalFromHeaders(req.headers);
  if (fromHeaders) {
    return { role: fromHeaders.role, agents: fromHeaders.agents, entry: fromHeaders.entry };
  }
  const url = new URL(req.url);
  let identity = devIdentity(env, url);
  const secret = env.SESSION_SECRET?.trim() ?? "";
  if (!identity && secret) {
    const session = await readChatSession(secret, {
      cookieHeader: req.headers.get("Cookie"),
      authorization: req.headers.get("Authorization"),
    }, now);
    if (session) {
      identity = { sub: session.sub, email: session.email ?? null };
    }
  }
  if (!identity) {
    return null;
  }
  return resolveUser(env, store, { sub: identity.sub, email: identity.email, emailVerified: true });
}

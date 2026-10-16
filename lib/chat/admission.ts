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
  _who: Pick<Resolved, "role" | "agents">,
  _slug: string,
  _session: RoomSession,
): HumanChatVerdict {
  return "ok";
}

/** Member assignment when DIRECTORY missed: read the Agent DO allow list (inventory already checked). */
export async function memberRoomUsersWhenNeeded(
  env: AgentEnv,
  slug: string,
  _role: Role,
  inDirectory: boolean,
): Promise<readonly RoomUser[]> {
  if (inDirectory) {
    return [];
  }
  const stub = agentStub(env, slug);
  if (!stub) {
    return [];
  }
  return fetchRoomUsers(stub);
}

/** Door row plus the sealed Google identity. `entry.sub` may be null on an email-only admin. */
export type DoorUser = Resolved & {
  sub: string;
  email: string | null;
};

/** Session email, or the allowlist email on the row this sub already matched. */
function listedEmail(sessionEmail: string | null | undefined, entryEmail: string | null | undefined): string | null {
  const fromSession = sessionEmail?.trim() ?? "";
  if (fromSession) {
    return fromSession;
  }
  const fromRow = entryEmail?.trim() ?? "";
  return fromRow || null;
}

export async function doorUserForRequest(
  env: AgentEnv & GateEnv,
  req: Request,
  store: UserStore,
  now = Date.now(),
): Promise<DoorUser | null> {
  const fromHeaders = principalFromHeaders(req.headers);
  if (fromHeaders) {
    return {
      role: fromHeaders.role,
      agents: fromHeaders.agents,
      entry: fromHeaders.entry,
      sub: fromHeaders.sub,
      email: listedEmail(fromHeaders.email, fromHeaders.entry.email),
    };
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
  const user = await resolveUser(env, store, { sub: identity.sub, email: identity.email, emailVerified: true });
  if (!user) {
    return null;
  }
  return { ...user, sub: identity.sub, email: listedEmail(identity.email, user.entry.email) };
}

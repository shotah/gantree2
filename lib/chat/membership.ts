/**
 * The `agents` a signed-in person may chat with, for `/api/auth/me`.
 *
 * Two lists meet here: the Settings row's grants (what an operator or member
 * was assigned) and room admission (the KV directory plus each candidate
 * room's own list). Grants are candidates, not membership — the room decides.
 */
import { settingsApi } from "@/lib/agents/http";
import type { Principal } from "@/lib/door/gate";
import { fetchRoomUsers } from "./allow";
import { admittedAgents } from "./directory";
import type { AgentEnv } from "./env";
import { deploymentFloorAllows } from "./floor";
import { agentStub } from "./location";

export type RoomsFor = (who: Principal) => Promise<string[]>;

async function householdAgentSlugs(env: AgentEnv): Promise<string[]> {
  const api = settingsApi(env);
  if (!api) {
    return [];
  }
  try {
    const rows = await api.listAgents();
    return rows.map((row) => row.slug).filter(Boolean);
  } catch {
    return [];
  }
}

export function roomsFor(env: AgentEnv): RoomsFor {
  return async (who) => {
    const session = {
      sub: who.sub,
      email: who.email ?? undefined,
      emailVerified: Boolean(who.email),
    };
    const admitted = await admittedAgents({
      kv: env.DIRECTORY,
      slugs: who.agents,
      session,
      extraSubs: env.ALLOWED_SUBS,
      rooms: async (slug) => {
        const stub = agentStub(env, slug);
        return stub ? fetchRoomUsers(stub) : [];
      },
    });
    if (!deploymentFloorAllows(env, session)) {
      return admitted;
    }
    const slugs = await householdAgentSlugs(env);
    if (slugs.length === 0) {
      return admitted;
    }
    return [...new Set([...admitted, ...slugs])].sort();
  };
}

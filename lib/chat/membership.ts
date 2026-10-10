/**
 * The `agents` a signed-in person may chat with, for `/api/auth/me`.
 *
 * Two lists meet here: the Settings row's grants (what an operator or member
 * was assigned) and room admission (the KV directory plus each candidate
 * room's own list). Grants are candidates, not membership — the room decides.
 */
import type { Principal } from "@/lib/door/gate";
import { fetchRoomUsers } from "./allow";
import { admittedAgents } from "./directory";
import type { AgentEnv } from "./env";
import { agentStub } from "./location";

export type RoomsFor = (who: Principal) => Promise<string[]>;

export function roomsFor(env: AgentEnv): RoomsFor {
  return (who) => admittedAgents({
    kv: env.DIRECTORY,
    slugs: who.agents,
    session: { sub: who.sub, email: who.email ?? undefined, emailVerified: Boolean(who.email) },
    extraSubs: env.ALLOWED_SUBS,
    rooms: async (slug) => {
      const stub = agentStub(env, slug);
      return stub ? fetchRoomUsers(stub) : [];
    },
  });
}

/**
 * The `agents` a signed-in person may chat with, for `/api/auth/me`.
 *
 * Two lists meet here: the Settings row's grants (what an operator or member
 * was assigned) and room admission (the KV directory plus each candidate
 * room's own list). Grants are candidates, not membership — the room decides.
 */
import type { Principal } from "@/lib/door/gate";
import { inventorySlugs } from "./admission";
import { fetchRoomUsers } from "./allow";
import { admittedAgents } from "./directory";
import type { AgentEnv } from "./env";
import { agentStub } from "./location";

export type RoomsFor = (who: Principal) => Promise<string[]>;

export function roomsFor(env: AgentEnv): RoomsFor {
  return async (who) => {
    const inventory = await inventorySlugs(env);
    if (inventory.length === 0) {
      return [];
    }
    if (who.role === "admin") {
      return inventory;
    }
    if (who.role === "operator") {
      const allowed = new Set(who.agents);
      return inventory.filter((slug) => allowed.has(slug));
    }
    const session = {
      sub: who.sub,
      email: who.email ?? undefined,
      emailVerified: Boolean(who.email),
    };
    return admittedAgents({
      kv: env.DIRECTORY,
      slugs: inventory,
      session,
      extraSubs: env.ALLOWED_SUBS,
      rooms: async (slug) => {
        const stub = agentStub(env, slug);
        return stub ? fetchRoomUsers(stub) : [];
      },
    });
  };
}

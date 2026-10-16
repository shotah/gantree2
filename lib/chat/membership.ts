/**
 * The `agents` a signed-in person may chat with, for `/api/auth/me`.
 *
 * Who can chat: the KV directory plus each candidate room's own list.
 * The phone apps read this from `/api/auth/me` and will not open a slug
 * that is missing from it.
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

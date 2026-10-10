import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AgentEnv } from "@/lib/chat/env";
import { roomsFor } from "@/lib/chat/membership";
import { principalFromHeaders, type Principal } from "@/lib/door/gate";
import { agentUnion, landing } from "@/lib/door/landing";
import { doorEnv } from "@/lib/door/runtime";

/** Never a static shell: the principal is on this request's headers. */
export const dynamic = "force-dynamic";

/**
 * Room list for the landing decision. `roomsFor` is the directory ∪ room
 * admission; union that with the header grants. If the worker env is missing,
 * the header grants are the whole list.
 */
async function chatAgents(who: Principal): Promise<string[]> {
  try {
    const env = doorEnv();
    if (!env) {
      return agentUnion(who.agents, []);
    }
    return agentUnion(who.agents, await roomsFor(env as typeof env & AgentEnv)(who));
  } catch {
    return agentUnion(who.agents, []);
  }
}

/** `/` is a router. Middleware already sent a missing session to /login. */
export default async function Home() {
  const who = principalFromHeaders(await headers());
  if (!who) {
    redirect("/login");
  }
  redirect(landing({ role: who.role, agents: await chatAgents(who) }));
}

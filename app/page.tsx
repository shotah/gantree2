import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { roomsFor } from "@/lib/chat/membership";
import { principalFromHeaders, type Principal } from "@/lib/door/gate";
import { agentUnion, landing, landingPref } from "@/lib/door/landing";
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
    return agentUnion(who.agents, await roomsFor(env)(who));
  } catch {
    return agentUnion(who.agents, []);
  }
}

/** `/` is a router. Middleware already sent a missing session to /login. A landing cookie can pick chat over the console. */
export default async function Home() {
  const incoming = await headers();
  const who = principalFromHeaders(incoming);
  if (!who) {
    redirect("/login");
  }
  redirect(landing({ role: who.role, agents: await chatAgents(who) }, landingPref(incoming.get("cookie"))));
}

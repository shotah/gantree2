/**
 * Worker entry. Vinext's fetch handler answers everything except `/ws/<slug>`,
 * which goes straight to the Agent Durable Object (before middleware, so the
 * room bearer is not refused for lacking a cookie). Every response but the
 * 101 upgrade itself gets the security headers (lib/door/headers.ts). The DO
 * classes are exported beside it so wrangler can bind them.
 */
import vinext from "vinext/server/fetch-handler";
import { withAgentSockets } from "@/lib/chat/entry";
import type { AgentEnv } from "@/lib/chat/env";
import { withSecurityHeaders } from "@/lib/door/headers";
import { userStore } from "@/lib/door/runtime";

export { Agent } from "@/edge/agent.do";
export { Settings } from "@/edge/settings.do";

const app = vinext as unknown as ExportedHandler<AgentEnv>;

export default {
  ...app,
  fetch: withSecurityHeaders(withAgentSockets<AgentEnv>((request, env, ctx) => {
    if (!app.fetch) {
      return new Response("no app handler", { status: 500 });
    }
    return app.fetch(request, env, ctx);
  }, userStore), process.env.NODE_ENV !== "production"),
} satisfies ExportedHandler<AgentEnv>;

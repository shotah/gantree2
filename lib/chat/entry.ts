/**
 * Worker-entry glue for the room, kept out of `worker/index.ts` so it is a
 * plain function Vitest can call.
 *
 * `/ws/<slug>` must be answered before the Vinext handler: middleware treats
 * it as an API and would 401 the harness bearer (no session cookie).
 */
import type { AgentEnv } from "./env";
import { routeAgentSocket, slugFromPath } from "./route";

/** Same shape as `ExportedHandler["fetch"]`, with the incoming `cf` typing wrangler gives the entry. */
export type Fetcher<E> = (
  request: Request<unknown, IncomingRequestCfProperties>,
  env: E,
  ctx: ExecutionContext,
) => Promise<Response> | Response;

export function isSocketPath(pathname: string): boolean {
  return pathname.startsWith("/ws/");
}

/** Wrap the app's fetch: sockets go to the Agent DO, everything else falls through. */
export function withAgentSockets<E extends AgentEnv>(next: Fetcher<E>): Fetcher<E> {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    if (!isSocketPath(url.pathname)) {
      return next(request, env, ctx);
    }
    const routed = await routeAgentSocket(request, env, slugFromPath(url.pathname));
    return routed ?? new Response("not found", { status: 404 });
  };
}

import { describe, expect, it, vi } from "vitest";
import { isSocketPath, withAgentSockets } from "@/lib/chat/entry";
import type { AgentEnv } from "@/lib/chat/env";

const ctx = {} as ExecutionContext;
/** The entry sees wrangler's incoming request type; a plain Request is the same object at runtime. */
const req = (url: string) => new Request(url) as Request<unknown, IncomingRequestCfProperties>;

describe("withAgentSockets", () => {
  it("knows the socket prefix", () => {
    expect(isSocketPath("/ws/kit")).toBe(true);
    expect(isSocketPath("/ws/")).toBe(true);
    expect(isSocketPath("/api/ws/kit")).toBe(false);
    expect(isSocketPath("/chat/kit")).toBe(false);
  });

  it("falls through to the app for everything else", async () => {
    const next = vi.fn(async () => new Response("app"));
    const fetch = withAgentSockets<AgentEnv>(next);
    const res = await fetch(req("https://g.test/chat/kit"), {}, ctx);
    expect(await res.text()).toBe("app");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("answers /ws/<slug> itself and never calls the app", async () => {
    const next = vi.fn(async () => new Response("app"));
    const fetch = withAgentSockets<AgentEnv>(next);
    // No role → the router's 404, proving the request went to the room path.
    const res = await fetch(req("https://g.test/ws/kit"), {}, ctx);
    expect(res.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("404s a bare /ws/ with no slug", async () => {
    const next = vi.fn(async () => new Response("app"));
    const res = await withAgentSockets<AgentEnv>(next)(req("https://g.test/ws/?role=phone"), {}, ctx);
    expect(res.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });
});

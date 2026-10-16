import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentsError,
  ME_URL,
  TOOLS_URL,
  agentUrl,
  agentsMessage,
  agentsUrl,
  codeOf,
  configUrl,
  selfUrl,
  personaUrl,
  createAgent,
  deleteAgent,
  getAgent,
  getConfig,
  getSelf,
  getPersona,
  getLog,
  getMe,
  getRoomUsers,
  getStatus,
  getAgentEnabled,
  restartAgent,
  listAgents,
  enabledUrl,
  listTools,
  logUrl,
  patchConfig,
  putRoomUsers,
  statusUrl,
  usersUrl,
  type ApiClient,
} from "@/app/lib/agentsHttp";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const status = {
  state: "ready",
  since: 1,
  version: "0.2.19",
  lastTurnAt: 1,
  lastTurn: 1,
  plugins: [{ name: "maps", state: "ready" }],
  published: ["maps"],
  skipped: [],
  lastError: null,
  perf: { turns: 0, prompt: 0, completion: 0, errors: 0 },
};

const agent = {
  slug: "kit",
  name: "Kit",
  createdBy: "s",
  createdAt: 1,
  tags: ["home"],
  status,
  canMutate: true,
};

const view = { envKeys: ["LLM_API_KEY"], mcp: "", persona: "hi", updatedAt: 1, recreate: false };

function href(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function client(handler: (url: string, init?: RequestInit) => Response): ApiClient {
  return (input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(href(input), init));
}

describe("agentsHttp", () => {
  it("builds contract urls", () => {
    expect(ME_URL).toBe("/api/auth/me");
    expect(TOOLS_URL).toBe("/api/tools");
    expect(agentsUrl()).toBe("/api/agents");
    expect(agentUrl("kit")).toBe("/api/agents/kit");
    expect(agentUrl("a/b")).toBe("/api/agents/a%2Fb");
    expect(configUrl("kit")).toBe("/api/agents/kit/config");
    expect(selfUrl("kit")).toBe("/api/agents/kit/self");
    expect(personaUrl("kit")).toBe("/api/agents/kit/persona");
    expect(statusUrl("kit")).toBe("/api/agents/kit/status");
    expect(logUrl("kit")).toBe("/api/agents/kit/log");
    expect(logUrl("kit", 0)).toBe("/api/agents/kit/log?after=0");
    expect(logUrl("kit", 4)).toBe("/api/agents/kit/log?after=4");
    expect(usersUrl("kit")).toBe("/api/agents/kit/users");
  });

  it("maps known errors and keeps unknown text", () => {
    expect(agentsMessage("forbidden")).toBe("You do not have access to that.");
    expect(agentsMessage("not_found")).toBe("That agent is not here.");
    expect(agentsMessage("slug_taken")).toBe("slug_taken");
    expect(codeOf(new AgentsError(404, "not_found"))).toBe("not_found");
    expect(codeOf(new Error("nope"))).toBe("request_failed");
  });

  it("reads each endpoint", async () => {
    const seen: { url: string; method: string; body?: string; type: string | null }[] = [];
    const http = client((url, init) => {
      seen.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        type: new Headers(init?.headers).get("content-type"),
      });
      if (url === "/api/auth/me") {
        return json(200, { sub: "s", email: null, role: "operator", agents: ["kit", 4] });
      }
      if (url === "/api/agents" && init?.method === "POST") {
        return json(201, { agent });
      }
      if (url === "/api/agents") {
        return json(200, { agents: [agent] });
      }
      if (url.endsWith("/config") && init?.method === "PATCH") {
        return json(200, view);
      }
      if (url.endsWith("/config")) {
        return json(200, view);
      }
      if (url.endsWith("/status")) {
        return json(200, status);
      }
      if ((url.split("?")[0] ?? url).endsWith("/log")) {
        return json(200, { lines: [{ seq: 1, at: "t", level: "info", message: "hi" }], next: 2 });
      }
      if (url.endsWith("/users") && init?.method === "PUT") {
        return json(200, { users: [{ email: "a@b.c" }] });
      }
      if (url.endsWith("/users")) {
        return json(200, { users: [{ sub: "1" }] });
      }
      if (url === "/api/agents/kit" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/agents/kit") {
        return json(200, { agent });
      }
      if (url === "/api/tools") {
        return json(200, { tools: [{ id: "maps", binary: "maps-bin", needs: [], optional: [], oauth: false, homeOnly: false }] });
      }
      return json(500, { error: url });
    });

    expect(await getMe(http)).toEqual({ sub: "s", email: null, role: "operator", agents: ["kit"] });
    expect(await listAgents(http)).toEqual([agent]);
    expect((await getAgent("kit", http)).slug).toBe("kit");
    expect((await createAgent({ slug: "kit", name: "Kit", tags: ["home"] }, http)).name).toBe("Kit");
    await deleteAgent("kit", http);
    expect((await getConfig("kit", http)).recreate).toBe(false);
    expect((await patchConfig("kit", { persona: "hi" }, http)).persona).toBe("hi");
    expect((await getStatus("kit", http)).state).toBe("ready");
    expect((await getLog("kit", undefined, http)).next).toBe(2);
    expect((await getLog("kit", 4, http)).lines).toHaveLength(1);
    expect(await getRoomUsers("kit", http)).toEqual([{ sub: "1" }]);
    expect(await putRoomUsers("kit", [{ email: "a@b.c" }], http)).toEqual([{ email: "a@b.c" }]);
    expect((await listTools(http))[0]?.id).toBe("maps");

    const post = seen.find((call) => call.method === "POST" && call.url === "/api/agents");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ slug: "kit", name: "Kit", tags: ["home"] });
    const patch = seen.find((call) => call.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ persona: "hi" });
    expect(patch?.type).toBe("application/json");
    const put = seen.find((call) => call.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ users: [{ email: "a@b.c" }] });
    expect(seen.some((call) => call.url === "/api/agents/kit/log?after=4")).toBe(true);
    expect(seen.some((call) => call.url === "/api/agents/kit/log" && call.method === "GET")).toBe(true);
  });

  it("uses api when the caller omits a client", async () => {
    const seenUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      await Promise.resolve();
      const url = href(input);
      seenUrls.push(url);
      const method = init?.method ?? "GET";
      if (url === "/api/auth/me") {
        return json(200, { sub: "s", role: "admin", agents: [] });
      }
      if (url === "/api/agents" && method === "POST") {
        return json(201, { agent });
      }
      if (url === "/api/agents") {
        return json(200, { agents: [] });
      }
      if (url.endsWith("/config")) {
        return json(200, view);
      }
      if (url.endsWith("/status")) {
        return json(200, status);
      }
      if ((url.split("?")[0] ?? url).endsWith("/log")) {
        return json(200, { lines: [], next: 0 });
      }
      if (url.endsWith("/users")) {
        return json(200, { users: [] });
      }
      if (url === "/api/tools") {
        return json(200, { tools: [] });
      }
      if (method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return json(200, { agent });
    });
    vi.stubGlobal("fetch", fetchMock);
    await getMe();
    await listAgents();
    await getAgent("kit");
    await createAgent({ slug: "kit" });
    await deleteAgent("kit");
    await getConfig("kit");
    await patchConfig("kit", { mcp: "" });
    await getStatus("kit");
    await getLog("kit");
    await getLog("kit", 3);
    await getRoomUsers("kit");
    await putRoomUsers("kit", []);
    await listTools();
    expect(fetchMock).toHaveBeenCalled();
    const first = fetchMock.mock.calls[0]?.[1];
    expect(first?.credentials).toBe("same-origin");
    expect(seenUrls).toContain("/api/agents/kit/log?after=3");
  });

  it("turns failures into AgentsError", async () => {
    const missing = client(() => json(200, {}));
    await expect(listAgents(missing)).rejects.toMatchObject({ name: "AgentsError", code: "bad_body", status: 200 });
    await expect(getAgent("kit", missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getConfig("kit", missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getSelf("kit", missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getPersona("kit", missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getStatus("kit", missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getLog("kit", 1, missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getRoomUsers("kit", missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(listTools(missing)).rejects.toMatchObject({ code: "bad_body" });
    await expect(getMe(missing)).rejects.toMatchObject({ code: "bad_body" });

    await expect(listAgents(client(() => json(200, { agents: [{ slug: "kit" }] })))).rejects.toMatchObject({ code: "bad_body" });
    await expect(getAgent("kit", client(() => json(200, { agent: { slug: "kit", name: "Kit" } })))).rejects.toMatchObject({ code: "bad_body" });
    await expect(getStatus("kit", client(() => json(200, { state: "asleep", plugins: [] })))).rejects.toMatchObject({ code: "bad_body" });
    await expect(getLog("kit", undefined, client(() => json(200, { lines: [], next: "0" })))).rejects.toMatchObject({ code: "bad_body" });
    await expect(getMe(client(() => json(200, { sub: "s", role: "guest", agents: [] })))).rejects.toMatchObject({ code: "bad_body" });
    await expect(getConfig("kit", client(() => json(200, { envKeys: [], mcp: "", persona: "", recreate: "yes" })))).rejects.toMatchObject({ code: "bad_body" });

    await expect(listAgents(client(() => json(403, { error: "forbidden" })))).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(listAgents(client(() => json(500, { error: "  " })))).rejects.toMatchObject({ code: "request_failed" });
    await expect(listAgents(client(() => json(500, { error: 3 })))).rejects.toMatchObject({ code: "request_failed" });
    await expect(listAgents(client(() => json(500, ["nope"])))).rejects.toMatchObject({ code: "request_failed" });
    await expect(listAgents(client(() => new Response("nope", { status: 500 })))).rejects.toMatchObject({ code: "request_failed" });
    await expect(listAgents(client(() => new Response("not-json", { status: 200 })))).rejects.toMatchObject({ code: "bad_body" });
    await expect(deleteAgent("kit", client(() => json(500, { error: "nope" })))).rejects.toMatchObject({ status: 500, code: "nope" });
    await expect(listAgents(() => {
      throw new Error("offline");
    })).rejects.toMatchObject({ status: 0, code: "request_failed" });

    const emailMissing = await getMe(client(() => json(200, { sub: "s", role: "member", agents: [] })));
    expect(emailMissing.email).toBeNull();
    expect(emailMissing.role).toBe("member");
  });

  it("reads enabled flag from GET /enabled", async () => {
    const http = client((url, init) => {
      if (url === enabledUrl("kit") && (init?.method ?? "GET") === "GET") {
        return json(200, { enabled: false });
      }
      return json(500, { error: "nope" });
    });
    expect(await getAgentEnabled("kit", http)).toBe(false);
    await expect(getAgentEnabled("kit", client(() => json(200, { enabled: "yes" })))).rejects.toMatchObject({
      code: "bad_body",
    });
  });

  it("posts restart and uses the returned status", async () => {
    const seen: string[] = [];
    const http = client((url, init) => {
      seen.push(`${init?.method ?? "GET"} ${url}`);
      return json(200, status);
    });
    expect((await restartAgent("kit", http)).state).toBe("ready");
    expect(seen).toEqual(["POST /api/agents/kit/restart"]);
  });
});

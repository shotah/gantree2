import { describe, expect, it } from "vitest";
import {
  ENV_SEARCH_KEY,
  TOOL_NAME,
  WebSearch,
} from "@/harness/plugins/websearch";

type Captured = { url: URL; method: string; token: string; accept: string; body: string };

function fakeFetch(body: string, status = 200): { fetch: typeof fetch; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    captured.push({
      url: new URL(href),
      method: (init?.method ?? "GET").toUpperCase(),
      token: headers.get("X-Subscription-Token") ?? "",
      accept: headers.get("Accept") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(body, {
      status,
      statusText: status === 401 ? "Unauthorized" : "OK",
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fetchImpl, captured };
}

describe("WebSearch.open", () => {
  it("requires SEARCH_API_KEY", () => {
    expect(() => WebSearch.open({})).toThrow(/SEARCH_API_KEY/);
  });

  it("reads the key from the env map", async () => {
    const { fetch: fetchImpl, captured } = fakeFetch(`{"web":{"results":[]}}`);
    const client = WebSearch.open({ env: { [ENV_SEARCH_KEY]: "from-env" }, fetch: fetchImpl });
    const out = await client.call(TOOL_NAME, { query: "nope" });
    expect(out).toBe("No results for \"nope\"");
    expect(captured[0]?.token).toBe("from-env");
  });
});

describe("WebSearch.search brave", () => {
  it("formats Brave hits and sends the subscription token", async () => {
    const { fetch: fetchImpl, captured } = fakeFetch(`{
      "web": {
        "results": [
          {"title": "Go", "url": "https://go.dev", "description": "The Go programming language"},
          {"title": "Tour", "url": "https://go.dev/tour", "description": "A tour of Go"}
        ]
      }
    }`);
    const client = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl });
    const out = await client.call(TOOL_NAME, { query: "golang" });
    const hit = captured[0];
    expect(hit?.method).toBe("GET");
    expect(hit?.url.searchParams.get("q")).toBe("golang");
    expect(hit?.url.searchParams.get("count")).toBe("8");
    expect(hit?.token).toBe("k");
    for (const want of ["Search results for \"golang\"", "1. Go", "https://go.dev"]) {
      expect(out).toContain(want);
    }
  });
});

describe("WebSearch.search tavily", () => {
  it("POSTs the Tavily body and maps content to snippets", async () => {
    const { fetch: fetchImpl, captured } = fakeFetch(JSON.stringify({
      results: [{ title: "T", url: "https://t.test", content: "snippet text" }],
    }));
    const client = WebSearch.open({
      apiKey: "tv-key",
      provider: "tavily",
      endpoint: "https://tavily.test/search",
      fetch: fetchImpl,
    });
    const out = await client.call(TOOL_NAME, { query: "q" });
    const hit = captured[0];
    expect(hit?.method).toBe("POST");
    expect(JSON.parse(hit?.body ?? "{}")).toMatchObject({
      api_key: "tv-key",
      query: "q",
      max_results: 8,
      include_answer: false,
    });
    expect(out).toContain("snippet text");
  });
});

describe("WebSearch.search serpapi", () => {
  it("GETs SerpAPI with engine, q, api_key, and num", async () => {
    const { fetch: fetchImpl, captured } = fakeFetch(JSON.stringify({
      organic_results: [{ title: "S", link: "https://s.test", snippet: "serp snippet" }],
    }));
    const client = WebSearch.open({
      apiKey: "sp-key",
      provider: "serpapi",
      endpoint: "https://serpapi.test/search.json",
      fetch: fetchImpl,
    });
    const out = await client.call(TOOL_NAME, { query: "find" });
    const hit = captured[0];
    expect(hit?.url.searchParams.get("engine")).toBe("google");
    expect(hit?.url.searchParams.get("q")).toBe("find");
    expect(hit?.url.searchParams.get("api_key")).toBe("sp-key");
    expect(hit?.url.searchParams.get("num")).toBe("8");
    expect(out).toContain("serp snippet");
  });
});

describe("WebSearch.search misc", () => {
  it("accepts the leftover alias and rejects an empty query", async () => {
    const { fetch: fetchImpl } = fakeFetch(`{"web":{"results":[]}}`);
    const client = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl });
    const out = await client.call("google-search__web_search", { query: "nope" });
    expect(out).toBe("No results for \"nope\"");
    await expect(client.call(TOOL_NAME, { query: "  " })).rejects.toThrow(/query is required/);
  });

  it("defaults provider to brave when SEARCH_PROVIDER is blank", async () => {
    const { fetch: fetchImpl, captured } = fakeFetch(`{"web":{"results":[]}}`);
    const client = WebSearch.open({
      env: { [ENV_SEARCH_KEY]: "k", SEARCH_PROVIDER: "" },
      fetch: fetchImpl,
      endpoint: "https://brave.test/search",
    });
    await client.call(TOOL_NAME, { query: "x" });
    expect(captured[0]?.token).toBe("k");
  });

  it("refuses to search when the client was not configured", async () => {
    const client = new WebSearch();
    await expect(client.call(TOOL_NAME, { query: "x" })).rejects.toThrow(/not configured/);
  });

  it("runs queries together and keeps a failed query as a row", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const q = new URL(href).searchParams.get("q");
      if (q === "bad") {
        return new Response(`{"error":{"detail":"nope"}}`, { status: 400, statusText: "Bad Request" });
      }
      return new Response(JSON.stringify({
        web: { results: [{ title: q ?? "", url: "https://example.test", description: "hit" }] },
      }), { status: 200 });
    };
    const tool = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl }).tool();
    const over = await tool.call({ queries: ["a", "b", "c", "d", "e", "f"] }, { userId: "u", sessionId: "s" });
    expect(over.isError).toBe(true);
    const result = await tool.call({ queries: ["good", "bad"] }, { userId: "u", sessionId: "s" });
    const rows = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "[]") as { query: string; results?: string; error?: string }[];
    expect(rows[0]?.results).toContain("Search results");
    expect(rows[1]?.error).toContain("nope");
  });
});

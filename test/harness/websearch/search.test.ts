import { describe, expect, it } from "vitest";
import { ENV_API_KEY, TOOL_NAME, WebSearch } from "@/harness/websearch";

type Captured = { url: URL; token: string; accept: string };

function fakeFetch(body: string, status = 200): { fetch: typeof fetch; captured: Captured[] } {
  const captured: Captured[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    captured.push({
      url: new URL(href),
      token: headers.get("X-Subscription-Token") ?? "",
      accept: headers.get("Accept") ?? "",
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
  it("requires BRAVE_SEARCH_API_KEY", () => {
    expect(() => WebSearch.open({})).toThrow(/BRAVE_SEARCH_API_KEY/);
  });

  it("reads the key from the env map", async () => {
    const { fetch: fetchImpl, captured } = fakeFetch(`{"web":{"results":[]}}`);
    const client = WebSearch.open({ env: { [ENV_API_KEY]: "from-env" }, fetch: fetchImpl });
    const out = await client.call(TOOL_NAME, { query: "nope" });
    expect(out).toBe("No results for \"nope\"");
    expect(captured[0]?.token).toBe("from-env");
  });
});

describe("WebSearch.search", () => {
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
    expect(hit?.url.searchParams.get("q")).toBe("golang");
    expect(hit?.url.searchParams.get("count")).toBe("8");
    expect(hit?.url.searchParams.get("key")).toBeNull();
    expect(hit?.token).toBe("k");
    expect(hit?.accept).toBe("application/json");
    for (const want of [
      "Search results for \"golang\"",
      "1. Go",
      "https://go.dev",
      "The Go programming language",
      "2. Tour",
      "https://go.dev/tour",
    ]) {
      expect(out).toContain(want);
    }
  });

  it("accepts the leftover alias and rejects an empty query", async () => {
    const { fetch: fetchImpl } = fakeFetch(`{"web":{"results":[]}}`);
    const client = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl });
    const out = await client.call("google-search__web_search", { query: "nope" });
    expect(out).toBe("No results for \"nope\"");
    await expect(client.call(TOOL_NAME, { query: "  " })).rejects.toThrow(/query is required/);
  });

  it("surfaces the Brave error detail", async () => {
    const { fetch: fetchImpl } = fakeFetch(`{"error":{"status":401,"detail":"Invalid subscription token"}}`, 401);
    const client = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl });
    await expect(client.call(TOOL_NAME, { query: "x" })).rejects.toThrow(/Invalid subscription token/);
  });

  it("refuses to search when the client was not configured", async () => {
    const client = new WebSearch();
    await expect(client.call(TOOL_NAME, { query: "x" })).rejects.toThrow(/not configured/);
  });

  it("labels a hit with no title", async () => {
    const { fetch: fetchImpl } = fakeFetch(`{"web":{"results":[{"title":"","url":"","description":"only snippet"}]}}`);
    const client = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl });
    const out = await client.search("q");
    expect(out).toContain("(no title)");
    expect(out).toContain("only snippet");
  });

  it("returns an error result from the tool when the query is empty", async () => {
    const { fetch: fetchImpl } = fakeFetch(`{"web":{"results":[]}}`);
    const tool = WebSearch.open({ apiKey: "k", endpoint: "https://brave.test/search", fetch: fetchImpl }).tool();
    const result = await tool.call({ query: "" }, { userId: "u", sessionId: "s" });
    expect(result.isError).toBe(true);
    const part = result.content[0];
    expect(part?.type === "text" ? part.text : "").toMatch(/query is required/);
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
    expect(over.content[0]?.type === "text" ? over.content[0].text : "").toContain("at most 5");
    const result = await tool.call({ queries: ["good", "bad"] }, { userId: "u", sessionId: "s" });
    expect(result.isError).toBeUndefined();
    const rows = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "[]") as { query: string; results?: string; error?: string }[];
    expect(rows[0]?.query).toBe("good");
    expect(rows[0]?.results).toContain("Search results");
    expect(rows[1]).toMatchObject({ query: "bad" });
    expect(rows[1]?.error).toContain("nope");
  });
});

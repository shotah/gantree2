import { describe, expect, it } from "vitest";
import {
  TOOL_NAME,
  WebSearch,
  isReplacedMcp,
  isSearchTool,
  resolveProvider,
  resolveSearchApiKey,
  toolDefs,
} from "@/harness/plugins/websearch";
import { websearchPlugin } from "@/harness/plugins/websearch";
import { fixedClock } from "@/harness/core/clock";
import { silentLogger } from "@/harness/core/log";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";
import { DatabaseSync } from "node:sqlite";

describe("websearch tools metadata", () => {
  it("replaces the leftover google-search MCP grant", () => {
    expect(isReplacedMcp("google-search", "unused")).toBe(true);
    expect(isReplacedMcp("x", "mcp-gemini-google-search")).toBe(true);
    expect(isReplacedMcp("maps", "maps-bin")).toBe(false);
  });

  it("recognizes search tool aliases", () => {
    for (const name of [TOOL_NAME, "google_search", "google-search__web_search", "google_search__web_search"]) {
      expect(isSearchTool(name)).toBe(true);
    }
    expect(isSearchTool("google__search_query")).toBe(false);
  });

  it("resolves provider and keys", () => {
    expect(resolveProvider({})).toBe("brave");
    expect(resolveProvider({ SEARCH_PROVIDER: "TAVILY" })).toBe("tavily");
    expect(resolveProvider({ SEARCH_PROVIDER: "nope" })).toBe("unknown");
    expect(resolveSearchApiKey({ SEARCH_API_KEY: " a " })).toBe("a");
    expect(resolveSearchApiKey({})).toBe("");
  });
});

describe("websearchPlugin.ready", () => {
  function ctx(env: Record<string, string>) {
    return {
      env,
      sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
      clock: fixedClock(0, "UTC"),
      log: silentLogger,
      fetch: () => Promise.reject(new Error("no fetch")),
      tokens: {
        get: () => Promise.resolve(null),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        list: async () => [],
      },
    };
  }

  it("returns no_key without a search key", async () => {
    expect(await websearchPlugin.ready(ctx({}))).toBe("no_key");
  });

  it("throws on an unknown provider", async () => {
    await expect(websearchPlugin.ready(ctx({ SEARCH_PROVIDER: "bing", SEARCH_API_KEY: "k" }))).rejects.toThrow(/unknown SEARCH_PROVIDER/);
  });

  it("returns null when configured", async () => {
    expect(await websearchPlugin.ready(ctx({ SEARCH_API_KEY: "k" }))).toBeNull();
  });

  it("tools() still returns web_search when provider is unknown", () => {
    const proxy = new Proxy({ SEARCH_PROVIDER: "bing" }, {
      get(target, key) {
        if (typeof key === "string" && Object.prototype.hasOwnProperty.call(target, key)) {
          return target[key as keyof typeof target];
        }
        return "x";
      },
    });
    const names = websearchPlugin.tools(ctx(proxy as Record<string, string>)).map((tool) => tool.name);
    expect(names).toEqual([TOOL_NAME]);
    expect(toolDefs()[0]?.name).toBe(TOOL_NAME);
  });
});

describe("unconfigured WebSearch", () => {
  it("refuses call()", async () => {
    const client = new WebSearch();
    await expect(client.call("google-search__web_search", { query: "x" })).rejects.toThrow(/not configured/);
  });
});

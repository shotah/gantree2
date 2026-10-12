import { describe, expect, it } from "vitest";
import { TOOL_NAME, WebSearch, isReplacedMcp, isSearchTool, toolDefs } from "@/harness/websearch";

describe("web search tools", () => {
  it("replaces the leftover google-search MCP grant", () => {
    expect(isReplacedMcp("google-search", "unused")).toBe(true);
    expect(isReplacedMcp("x", "mcp-gemini-google-search")).toBe(true);
    expect(isReplacedMcp("google", "google-mcp")).toBe(false);
    expect(isReplacedMcp("math", "mcp-go-math")).toBe(false);
  });

  it("recognizes the builtin name and the leftover aliases", () => {
    for (const name of [TOOL_NAME, "google_search", "google-search__web_search", "google_search__web_search"]) {
      expect(isSearchTool(name)).toBe(true);
    }
    expect(isSearchTool("google__search_query")).toBe(false);
    expect(isSearchTool("memory_store")).toBe(false);
  });

  it("publishes one web_search tool", () => {
    const defs = toolDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe(TOOL_NAME);
    expect(defs[0]?.description).toContain("web_search");
  });

  it("routes aliases to the builtin and leaves other names unknown", async () => {
    const client = new WebSearch();
    await expect(client.call(TOOL_NAME, { query: "x" })).rejects.toThrow(/not configured/);
    await expect(client.call("google-search__web_search", { query: "x" })).rejects.toThrow(/not configured/);
    await expect(client.call("demo__echo", null)).rejects.toThrow(/unknown tool/);
  });
});

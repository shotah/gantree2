import { describe, expect, it } from "vitest";
import { formatCustomSearchResults, formatSearchFacets, formatSearchResultMetadata } from "@/brain/plugins/google/search";
import { callTool, jsonResponse, recordingFetch, testCtx, textOf } from "@/test/brain/plugins/google/harness";

const pseEnv = {
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
  GOOGLE_PSE_API_KEY: "pse-key",
  GOOGLE_PSE_ENGINE_ID: "cx-1",
  GOOGLE_TOOL_PRESET: "all",
};

describe("search formatters", () => {
  it("fills defaults, flattens snippets, and prints metadata", () => {
    const text = formatCustomSearchResults([
      {
        snippet: "line1\nline2",
        pagemap: { metatags: [{ "og:type": "article", "article:published_time": "2026-01-15T12:00:00Z" }] },
      },
      { title: "Title", link: "https://example.com", snippet: "ok" },
    ], 1);
    expect(text).toContain("1. No title");
    expect(text).toContain("Snippet: line1 line2");
    expect(text).toContain("Type: article");
    expect(text).toContain("Published: 2026-01-15");
    expect(text).toContain("2. Title");
    expect(formatSearchResultMetadata(undefined)).toBe("");
    expect(formatSearchResultMetadata("{")).toBe("");
  });

  it("formats facets", () => {
    expect(formatSearchFacets(undefined)).toBe("");
    const text = formatSearchFacets([
      [{ label: "Docs", anchor: "docs" }, { label: "", anchor: "" }],
      "skip-me",
    ]);
    expect(text).toContain("- Docs (anchor: docs)");
    expect(text).toContain("- Unknown (anchor: Unknown)");
  });
});

describe("pse tools", () => {
  it("requires q, then the API key, and never an email", async () => {
    const missingQ = await callTool(testCtx(), "pse_search", {});
    expect(textOf(missingQ)).toContain("q is required");
    const missingKey = await callTool(testCtx({
      env: { GOOGLE_OAUTH_CLIENT_ID: "cid", GOOGLE_OAUTH_CLIENT_SECRET: "csecret", GOOGLE_TOOL_PRESET: "all" },
    }), "pse_search", { q: "test query" });
    expect(missingKey.isError).toBe(true);
    expect(textOf(missingKey)).toContain("GOOGLE_PSE_API_KEY");
    expect(textOf(missingKey).toLowerCase()).not.toContain("user_google_email");
    const missingCx = await callTool(testCtx({
      env: { GOOGLE_PSE_API_KEY: "k", GOOGLE_TOOL_PRESET: "all" },
    }), "pse_get_engine_info");
    expect(textOf(missingCx)).toContain("GOOGLE_PSE_ENGINE_ID");
  });

  it("formats a result page and a site-restricted query", async () => {
    const { fetch, hits } = recordingFetch((hit) => {
      expect(hit.authorization).toBe("");
      expect(hit.url.searchParams.get("key")).toBe("pse-key");
      expect(hit.url.searchParams.get("cx")).toBe("cx-1");
      return jsonResponse({
        searchInformation: { totalResults: "20", searchTime: 0.25 },
        items: [{ title: "Ada", link: "https://ada.example", snippet: "hi" }],
        queries: { nextPage: [{ startIndex: 11 }] },
      });
    });
    const text = textOf(await callTool(testCtx({ env: pseEnv, fetch }), "pse_search", { q: "ada" }));
    expect(hits[0]?.url.searchParams.get("q")).toBe("ada");
    expect(hits[0]?.url.searchParams.get("safe")).toBe("off");
    expect(text).toContain("- Query: \"ada\"");
    expect(text).toContain("- Search Time: 0.250 seconds");
    expect(text).toContain("- Results Returned: 1 (showing 1 to 1)");
    expect(text).toContain("1. Ada");
    expect(text).toContain("search again with start=11");

    const sites = recordingFetch(() => jsonResponse({ items: [] }));
    const empty = textOf(await callTool(testCtx({ env: pseEnv, fetch: sites.fetch }), "pse_search_siterestrict", {
      q: "docs",
      sites: ["example.com", "ada.dev"],
    }));
    expect(sites.hits[0]?.url.searchParams.get("q")).toBe("docs (site:example.com OR site:ada.dev)");
    expect(empty).toContain("No results found.");
  });

  it("reads engine title and facets", async () => {
    const { fetch, hits } = recordingFetch(() => jsonResponse({
      context: { title: "Workspace", facets: [[{ label: "Docs", anchor: "docs" }]] },
      searchInformation: { totalResults: "9" },
    }));
    const text = textOf(await callTool(testCtx({ env: pseEnv, fetch }), "pse_get_engine_info"));
    expect(hits[0]?.url.searchParams.get("q")).toBe("test");
    expect(hits[0]?.url.searchParams.get("num")).toBe("1");
    expect(hits[0]?.url.searchParams.has("safe")).toBe(false);
    expect(text).toContain("- Search Engine ID: cx-1");
    expect(text).toContain("- Title: Workspace");
    expect(text).toContain("- Docs (anchor: docs)");
    expect(text).toContain("Total indexed results: 9");
  });
});

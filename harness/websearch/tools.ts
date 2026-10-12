import { type JsonSchema, type ToolDef } from "@/harness/core/tools";

/** Builtin exposed to the model (not MCP-prefixed). */
export const TOOL_NAME = "web_search";

/** Env map key. Same name the Go config reads. */
export const ENV_API_KEY = "BRAVE_SEARCH_API_KEY";

export const DEFAULT_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export const DEFAULT_COUNT = 8;

export const HTTP_TIMEOUT_MS = 15_000;

const TOOL_DESCRIPTION = "Web search. Exact name: web_search. "
  + "Do not invent google_search, duckduckgo, or MCP-prefixed names — leftover google-search__web_search still works. "
  + "Returns titles, URLs, and snippets. It does not update calendars. "
  + "If they asked to put a found address on a calendar event, call the calendar tool next. "
  + "queries accepts up to 5 searches; query still works for one. One failed query is an error row.";

export const MAX_QUERIES = 5;

export function toolDefs(): ToolDef[] {
  const parameters: JsonSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query. For places/businesses, include the name and city/region (e.g. \"Edgeworks Bellevue address\").",
      },
      queries: {
        type: "array",
        description: "Search queries to run together (max 5). query still works for one.",
        items: { type: "string" },
      },
    },
    required: ["query"],
  };
  return [{
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema: parameters,
  }];
}

/** Leftover google-search MCP grants that the builtin replaces. */
export function isReplacedMcp(name: string, command: string): boolean {
  return name.trim() === "google-search" || command.trim() === "mcp-gemini-google-search";
}

/** The builtin name and leftover MCP / invented aliases. */
export function isSearchTool(name: string): boolean {
  switch (name.trim()) {
    case TOOL_NAME:
    case "google_search":
    case "google-search__web_search":
    case "google_search__web_search":
      return true;
    default:
      return false;
  }
}

/**
 * Builtin Brave web search. The model calls unprefixed `web_search`.
 * The key is `BRAVE_SEARCH_API_KEY` on the env map passed to `WebSearch`.
 */
export { WebSearch } from "./search";
export type { WebSearchDeps } from "./search";
export {
  DEFAULT_COUNT,
  DEFAULT_ENDPOINT,
  ENV_API_KEY,
  HTTP_TIMEOUT_MS,
  MAX_QUERIES,
  TOOL_NAME,
  isReplacedMcp,
  isSearchTool,
  toolDefs,
} from "./tools";

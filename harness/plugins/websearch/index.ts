/**
 * Web search plugin. Publishes unprefixed `web_search` when granted.
 */
import type { Plugin, PluginContext, Tool } from "@/harness/core/tools";
import { WebSearch } from "./search";
import { ENV_PROVIDER, resolveProvider, resolveSearchApiKey } from "./tools";

export { keys } from "./keys";
export { WebSearch } from "./search";
export type { WebSearchDeps } from "./search";
export {
  BRAVE_DEFAULT_ENDPOINT,
  DEFAULT_COUNT,
  ENV_PROVIDER,
  ENV_SEARCH_KEY,
  HTTP_TIMEOUT_MS,
  MAX_QUERIES,
  SERPAPI_DEFAULT_ENDPOINT,
  TAVILY_DEFAULT_ENDPOINT,
  TOOL_NAME,
  isReplacedMcp,
  isSearchTool,
  resolveProvider,
  resolveSearchApiKey,
  toolDefs,
} from "./tools";

function webSearchTool(ctx: PluginContext): Tool {
  const client = new WebSearch({ env: ctx.env, fetch: ctx.fetch });
  return client.tool();
}

export const websearchPlugin: Plugin = {
  name: "websearch",
  bare: true,
  ready(ctx) {
    const provider = resolveProvider(ctx.env);
    if (provider === "unknown") {
      const raw = (ctx.env[ENV_PROVIDER] ?? "").trim();
      return Promise.reject(new Error(`websearch: unknown SEARCH_PROVIDER ${JSON.stringify(raw)}`));
    }
    if (resolveSearchApiKey(ctx.env) === "") {
      return Promise.resolve("no_key");
    }
    return Promise.resolve(null);
  },
  tools(ctx) {
    return [webSearchTool(ctx)];
  },
};

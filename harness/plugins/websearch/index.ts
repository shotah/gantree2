/**
 * Web search plugin. Publishes unprefixed `web_search` when granted.
 */
import type { Plugin, PluginContext, Tool } from "@/harness/core/tools";
import { WebSearch } from "./search";
import { ENV_PROVIDER, resolveProvider, resolveSearchApiKey } from "./tools";

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

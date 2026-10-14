import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "SEARCH_API_KEY",
    label: "Search API key",
    help: "API key for web search — Brave at https://api.search.brave.com/app/keys, Tavily at https://app.tavily.com, or SerpAPI at https://serpapi.com/manage-api-key.",
    example: "BSA...",
    where: "https://api.search.brave.com/app/keys",
    kind: "secret",
  },
  {
    name: "SEARCH_PROVIDER",
    label: "Search provider",
    help: "Blank means brave; use brave, tavily, or serpapi.",
    example: "brave",
    where: "https://api.search.brave.com/app/keys",
    optional: true,
    kind: "text",
  },
];

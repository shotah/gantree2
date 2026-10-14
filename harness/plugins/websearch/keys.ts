import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "SEARCH_API_KEY",
    label: "Search API key",
    help: "Create an account and copy the key for one engine: Brave at https://api.search.brave.com/app/keys, Tavily at https://app.tavily.com, or SerpAPI at https://serpapi.com/manage-api-key.",
    example: "BSA...",
    where: "https://api.search.brave.com/app/keys",
    kind: "secret",
  },
  {
    name: "SEARCH_PROVIDER",
    label: "Search provider",
    help: "Which engine that key belongs to: brave, tavily, or serpapi. Leave it blank for Brave.",
    example: "brave",
    where: "https://api.search.brave.com/app/keys",
    optional: true,
    kind: "text",
  },
];

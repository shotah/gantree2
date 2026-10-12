import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "SERPAPI_API_KEY",
    label: "SerpAPI key",
    help: "API key for flight search, from the SerpAPI dashboard at https://serpapi.com/manage-api-key.",
    example: "a1b2c3...",
    where: "https://serpapi.com/manage-api-key",
    kind: "secret",
  },
];

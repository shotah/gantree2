import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "SERPAPI_API_KEY",
    label: "SerpAPI key",
    help: "Sign up at https://serpapi.com, open https://serpapi.com/manage-api-key, and copy the private API key. Flight search uses that key.",
    example: "a1b2c3...",
    where: "https://serpapi.com/manage-api-key",
    kind: "secret",
  },
];

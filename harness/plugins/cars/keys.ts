import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "MARKETCHECK_API_KEY",
    label: "MarketCheck API key",
    help: "Sign up for a MarketCheck developer plan and create an API key from the dashboard. Free tier includes about 500 calls per month.",
    example: "mc_…",
    where: "https://www.marketcheck.com/apis/pricing",
    kind: "secret",
  },
  {
    name: "MARKETCHECK_BASE_URL",
    label: "MarketCheck API base URL",
    help: "Override the default MarketCheck API host when using a proxy or staging endpoint.",
    example: "https://api.marketcheck.com/v2",
    where: "https://www.marketcheck.com/",
    kind: "text",
    optional: true,
  },
];

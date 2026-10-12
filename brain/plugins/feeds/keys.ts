import { type PluginKeyMeta } from "@/lib/agents/keys";

/** Optional. Feeds publish with no key; this only overrides the User-Agent. */
export const keys: readonly PluginKeyMeta[] = [
  {
    name: "FEEDS_USER_AGENT",
    label: "Feed user agent",
    help: "Optional User-Agent for feed fetches; leave it unset and feeds send the default gantree contact string.",
    example: "gantree/... (+https://gantree2.bldhosting.com)",
    where: "https://gantree2.bldhosting.com",
    optional: true,
    kind: "text",
  },
];

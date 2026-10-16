import { type PluginKeyMeta } from "@/lib/agents/keys";

/** Optional. Feeds publish with no key; this only overrides the User-Agent. */
export const keys: readonly PluginKeyMeta[] = [
  {
    name: "FEEDS_USER_AGENT",
    label: "Feed user agent",
    help: "Optional. Leave it unset and feeds send the default gantree contact string. Set one only if a site blocks that default.",
    example: "gantree/... (+https://gantree.bldhosting.com)",
    where: "https://gantree.bldhosting.com",
    optional: true,
    kind: "text",
  },
];

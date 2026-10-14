import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "X_BEARER_TOKEN",
    label: "X bearer token",
    help: "In the X developer portal at https://developer.x.com/en/portal/dashboard, open your app, then Keys and tokens, and generate a Bearer Token.",
    example: "AAAA...",
    where: "https://developer.x.com/en/portal/dashboard",
    kind: "secret",
  },
];

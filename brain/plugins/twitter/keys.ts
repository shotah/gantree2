import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "X_BEARER_TOKEN",
    label: "X bearer token",
    help: "App-only bearer for reading posts, from the X developer portal at https://developer.x.com/en/portal/dashboard.",
    example: "AAAA...",
    where: "https://developer.x.com/en/portal/dashboard",
    kind: "secret",
  },
];

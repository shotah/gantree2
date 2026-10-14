import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "RENTCAST_API_KEY",
    label: "RentCast API key",
    help: "Sign in at https://app.rentcast.io/app/api, pick a plan, and click Create API key. A free developer plan includes a small monthly quota.",
    example: "rc_...",
    where: "https://app.rentcast.io/app/api",
    kind: "secret",
  },
];

import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "RENTCAST_API_KEY",
    label: "RentCast API key",
    help: "API key for US rental listings, from a RentCast account at https://www.rentcast.io/api.",
    example: "rc_...",
    where: "https://www.rentcast.io/api",
    kind: "secret",
  },
];

import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "GOOGLE_MAPS_API_KEY",
    label: "Maps API key",
    help: "Maps Platform key with Places and Directions enabled, from https://console.cloud.google.com/google/maps-apis/credentials.",
    example: "AIza...",
    where: "https://console.cloud.google.com/google/maps-apis/credentials",
    kind: "secret",
  },
];

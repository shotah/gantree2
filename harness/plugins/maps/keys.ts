import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "GOOGLE_MAPS_API_KEY",
    label: "Maps API key",
    help: "In Google Cloud, enable Places API and Directions API, then create a key at https://console.cloud.google.com/google/maps-apis/credentials.",
    example: "AIza...",
    where: "https://console.cloud.google.com/google/maps-apis/credentials",
    kind: "secret",
  },
];

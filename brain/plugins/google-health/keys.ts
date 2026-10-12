import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "GOOGLE_HEALTH_CLIENT_ID",
    label: "Health client id",
    help: "OAuth client id for the Google Health API, from https://console.cloud.google.com/apis/credentials.",
    example: "123-abc.apps.googleusercontent.com",
    where: "https://console.cloud.google.com/apis/credentials",
    kind: "text",
  },
  {
    name: "GOOGLE_HEALTH_CLIENT_SECRET",
    label: "Health client secret",
    help: "OAuth client secret paired with the Health client id, from https://console.cloud.google.com/apis/credentials.",
    example: "GOCSPX-...",
    where: "https://console.cloud.google.com/apis/credentials",
    kind: "secret",
  },
];

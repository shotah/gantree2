import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "GOOGLE_HEALTH_CLIENT_ID",
    label: "Health client id",
    help: "Create a Web application OAuth client at https://console.cloud.google.com/apis/credentials, enable the Google Health API, and add this site's /api/auth/catch as an authorized redirect URI.",
    example: "123-abc.apps.googleusercontent.com",
    where: "https://console.cloud.google.com/apis/credentials",
    kind: "text",
  },
  {
    name: "GOOGLE_HEALTH_CLIENT_SECRET",
    label: "Health client secret",
    help: "Client secret for that Health OAuth client, from https://console.cloud.google.com/apis/credentials.",
    example: "GOCSPX-...",
    where: "https://console.cloud.google.com/apis/credentials",
    kind: "secret",
  },
];

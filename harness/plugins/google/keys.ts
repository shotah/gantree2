import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    label: "Google client id",
    help: "OAuth client id for Gmail, Calendar, and Drive, from https://console.cloud.google.com/apis/credentials.",
    example: "123-abc.apps.googleusercontent.com",
    where: "https://console.cloud.google.com/apis/credentials",
    kind: "text",
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    label: "Google client secret",
    help: "OAuth client secret paired with the Google client id, from https://console.cloud.google.com/apis/credentials.",
    example: "GOCSPX-...",
    where: "https://console.cloud.google.com/apis/credentials",
    kind: "secret",
  },
  {
    name: "GOOGLE_TOOL_PRESET",
    label: "Google tool preset",
    help: "Optional Google tool set, one of everyday, lean, or all; leave it unset for everyday.",
    example: "lean",
    where: "https://github.com/shotah/gantree2/blob/main/docs/mcp.md#keys",
    optional: true,
    kind: "text",
  },
];

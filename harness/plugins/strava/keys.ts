import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "STRAVA_CLIENT_ID",
    label: "Strava client id",
    help: "Create an API application at https://www.strava.com/settings/api. Authorization Callback Domain is this site's hostname only, then copy the client id.",
    example: "12345",
    where: "https://www.strava.com/settings/api",
    kind: "text",
  },
  {
    name: "STRAVA_CLIENT_SECRET",
    label: "Strava client secret",
    help: "Client secret from that same Strava API application at https://www.strava.com/settings/api.",
    example: "a1b2...",
    where: "https://www.strava.com/settings/api",
    kind: "secret",
  },
];

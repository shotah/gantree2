import { type PluginKeyMeta } from "@/lib/agents/keys";

export const keys: readonly PluginKeyMeta[] = [
  {
    name: "STRAVA_CLIENT_ID",
    label: "Strava client id",
    help: "OAuth client id from your Strava API application at https://www.strava.com/settings/api, where Authorization Callback Domain is the site hostname only.",
    example: "12345",
    where: "https://www.strava.com/settings/api",
    kind: "text",
  },
  {
    name: "STRAVA_CLIENT_SECRET",
    label: "Strava client secret",
    help: "OAuth client secret from the same Strava API application at https://www.strava.com/settings/api.",
    example: "a1b2...",
    where: "https://www.strava.com/settings/api",
    kind: "secret",
  },
];

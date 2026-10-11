/**
 * Tools the settings grid and `/api/tools` list. One row per in-process
 * plugin, in `allPlugins` order. `needs` are the env keys `ready()` treats
 * as `no_key`. `GARMIN_TOOL_TIER` defaults to core and `GOOGLE_TOOL_PRESET`
 * defaults to everyday, so neither is a required key.
 */
import { allPlugins } from "@/brain/plugins";
import type { ToolEntry } from "./types";
import { oauthRedirectPlugin } from "./oauth";

const NEEDS: Readonly<Record<string, readonly string[]>> = {
  feeds: ["FEEDS_USER_AGENT"],
  twitter: ["X_BEARER_TOKEN"],
  strava: ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET"],
  maps: ["GOOGLE_MAPS_API_KEY"],
  flights: ["SERPAPI_API_KEY"],
  rentals: ["RENTCAST_API_KEY"],
  "google-health": ["GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET"],
  google: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  garmin: ["GARMIN_EMAIL", "GARMIN_PASSWORD"],
};

export function toolCatalog(): ToolEntry[] {
  return allPlugins.map((plugin) => ({
    id: plugin.name,
    binary: plugin.name,
    needs: [...(NEEDS[plugin.name] ?? [])],
    oauth: oauthRedirectPlugin(plugin.name),
    homeOnly: false,
  }));
}

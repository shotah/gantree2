/**
 * Tools the settings grid and `/api/tools` list. One row per in-process
 * plugin, in `allPlugins` order. `needs` are the required keys from
 * `KNOWN_KEYS`. Optional keys (`FEEDS_USER_AGENT`, `SEARCH_PROVIDER`,
 * `IMAGE_API_KEY`, `GARMIN_TOOL_TIER`, `GOOGLE_TOOL_PRESET`) are not required.
 */
import { allPlugins } from "@/harness/plugins";
import { needsOf, optionalOf } from "./keys";
import { oauthRedirectPlugin } from "./oauth";
import type { ToolEntry } from "./types";

export function toolCatalog(): ToolEntry[] {
  return allPlugins.map((plugin) => ({
    id: plugin.name,
    binary: plugin.name,
    needs: needsOf(plugin.name),
    optional: optionalOf(plugin.name),
    oauth: oauthRedirectPlugin(plugin.name),
    homeOnly: false,
  }));
}

/**
 * In-process plugins, in manifest order. A module that does not
 * export a plugin is left out; the loop publishes whatever is here.
 */
import type { Plugin } from "@/harness/core/tools";
import { chatPlugin } from "@/harness/plugins/chat";
import { feedsPlugin } from "@/harness/plugins/feeds";
import { flights } from "@/harness/plugins/flights";
import { atlassian } from "@/harness/plugins/atlassian";
import { cars } from "@/harness/plugins/cars";
import { garmin } from "@/harness/plugins/garmin";
import { google } from "@/harness/plugins/google";
import { googleHealth } from "@/harness/plugins/google-health";
import { imagePlugin } from "@/harness/plugins/image";
import { maps } from "@/harness/plugins/maps";
import { mathPlugin } from "@/harness/plugins/math";
import { websearchPlugin } from "@/harness/plugins/websearch";
import { rentals } from "@/harness/plugins/rentals";
import { strava } from "@/harness/plugins/strava";
import { twitterPlugin } from "@/harness/plugins/twitter";

function listed(plugin: Plugin | undefined): Plugin[] {
  if (!plugin || typeof plugin.name !== "string" || plugin.name === "") {
    return [];
  }
  if (typeof plugin.ready !== "function" || typeof plugin.tools !== "function") {
    return [];
  }
  return [plugin];
}

export const allPlugins: Plugin[] = [
  ...listed(chatPlugin),
  ...listed(feedsPlugin),
  ...listed(mathPlugin),
  ...listed(websearchPlugin),
  ...listed(twitterPlugin),
  ...listed(imagePlugin),
  ...listed(strava),
  ...listed(maps),
  ...listed(flights),
  ...listed(rentals),
  ...listed(googleHealth),
  ...listed(google),
  ...listed(garmin),
  ...listed(atlassian),
  ...listed(cars),
];

/**
 * The twelve in-process plugins, in manifest order. A module that does not
 * export a plugin is left out; the loop publishes whatever is here.
 */
import type { Plugin } from "@/brain/core/tools";
import { chatPlugin } from "@/brain/plugins/chat";
import { feedsPlugin } from "@/brain/plugins/feeds";
import { flights } from "@/brain/plugins/flights";
import { garmin } from "@/brain/plugins/garmin";
import { google } from "@/brain/plugins/google";
import { googleHealth } from "@/brain/plugins/google-health";
import { imagePlugin } from "@/brain/plugins/image";
import { maps } from "@/brain/plugins/maps";
import { mathPlugin } from "@/brain/plugins/math";
import { rentals } from "@/brain/plugins/rentals";
import { strava } from "@/brain/plugins/strava";
import { twitterPlugin } from "@/brain/plugins/twitter";

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
  ...listed(twitterPlugin),
  ...listed(imagePlugin),
  ...listed(strava),
  ...listed(maps),
  ...listed(flights),
  ...listed(rentals),
  ...listed(googleHealth),
  ...listed(google),
  ...listed(garmin),
];

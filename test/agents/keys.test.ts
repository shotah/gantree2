import { describe, expect, it } from "vitest";
import { keys as atlassianKeys } from "@/harness/plugins/atlassian/keys";
import { keys as carsKeys } from "@/harness/plugins/cars/keys";
import { keys as feedsKeys } from "@/harness/plugins/feeds";
import { keys as flightsKeys } from "@/harness/plugins/flights";
import { keys as garminKeys } from "@/harness/plugins/garmin";
import { keys as googleKeys } from "@/harness/plugins/google";
import { keys as imageKeys } from "@/harness/plugins/image";
import { keys as googleHealthKeys } from "@/harness/plugins/google-health";
import { keys as mapsKeys } from "@/harness/plugins/maps";
import { keys as websearchKeys } from "@/harness/plugins/websearch/keys";
import { keys as rentalsKeys } from "@/harness/plugins/rentals";
import { keys as stravaKeys } from "@/harness/plugins/strava";
import { keys as twitterKeys } from "@/harness/plugins/twitter";
import { toolCatalog } from "@/lib/agents/catalog";
import { HOUSE_KEYS, LLM_KEYS } from "@/lib/agents/house";
import { KNOWN_KEYS, needsOf, pickerKeys } from "@/lib/agents/keys";

const exported = [
  ["feeds", feedsKeys],
  ["websearch", websearchKeys],
  ["twitter", twitterKeys],
  ["image", imageKeys],
  ["strava", stravaKeys],
  ["maps", mapsKeys],
  ["flights", flightsKeys],
  ["rentals", rentalsKeys],
  ["google-health", googleHealthKeys],
  ["google", googleKeys],
  ["garmin", garminKeys],
  ["atlassian", atlassianKeys],
  ["cars", carsKeys],
] as const;

describe("KNOWN_KEYS", () => {
  it("derives plugin rows from each plugin export, then needs from the required ones", () => {
    expect(KNOWN_KEYS.filter((key) => key.plugin === "house").map((key) => key.name)).toEqual([...LLM_KEYS]);
    expect([...HOUSE_KEYS]).toEqual([...LLM_KEYS, "SEARCH_API_KEY", "SEARCH_PROVIDER"]);
    expect(new Set(KNOWN_KEYS.map((key) => key.name)).size).toBe(KNOWN_KEYS.length);
    for (const [plugin, list] of exported) {
      expect(KNOWN_KEYS.filter((key) => key.plugin === plugin).map((key) => key.name)).toEqual(list.map((key) => key.name));
      expect(needsOf(plugin)).toEqual(list.filter((key) => key.optional !== true).map((key) => key.name));
    }
    const plugins = KNOWN_KEYS.map((key) => key.plugin).filter((plugin, index, all) => all.indexOf(plugin) === index);
    expect(plugins).toEqual(["house", ...exported.map(([plugin]) => plugin)]);
    expect(needsOf("feeds")).toEqual([]);
    expect(needsOf("flights")).toEqual(["SERPAPI_API_KEY"]);
    expect(needsOf("rentals")).toEqual(["RENTCAST_API_KEY"]);
    expect(needsOf("garmin")).toEqual(["GARMIN_EMAIL", "GARMIN_PASSWORD"]);
    expect(needsOf("google")).toEqual(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]);
    for (const tool of toolCatalog()) {
      expect(tool.needs).toEqual(needsOf(tool.id));
    }
    expect(toolCatalog().find((tool) => tool.id === "feeds")?.needs).toEqual([]);
    expect(KNOWN_KEYS.find((key) => key.name === "FEEDS_USER_AGENT")?.optional).toBe(true);
    expect(KNOWN_KEYS.find((key) => key.name === "IMAGE_API_KEY")?.optional).toBe(true);
    expect(KNOWN_KEYS.find((key) => key.name === "GARMIN_TOOL_TIER")?.optional).toBe(true);
    expect(KNOWN_KEYS.find((key) => key.name === "GOOGLE_TOOL_PRESET")?.optional).toBe(true);
    for (const key of KNOWN_KEYS) {
      expect(key.help.endsWith("."), key.name).toBe(true);
      expect(key.where.startsWith("https://"), key.name).toBe(true);
    }
  });

  it("leaves set keys and house keys out of the picker, house first", () => {
    const picked = pickerKeys(
      ["X_BEARER_TOKEN", "LLM_MODEL"],
      ["SEARCH_API_KEY", "LLM_API_KEY"],
    );
    const names = picked.map((key) => key.name);
    expect(names).not.toContain("X_BEARER_TOKEN");
    expect(names).not.toContain("LLM_MODEL");
    expect(names).not.toContain("SEARCH_API_KEY");
    expect(names).not.toContain("LLM_API_KEY");
    expect(names[0]).toBe("LLM_BASE_URL");
    expect(picked[0]?.plugin).toBe("house");
    expect(names).toContain("FEEDS_USER_AGENT");
    expect(names).toContain("GARMIN_EMAIL");
    expect(names.indexOf("LLM_BASE_URL")).toBeLessThan(names.indexOf("FEEDS_USER_AGENT"));
  });
});

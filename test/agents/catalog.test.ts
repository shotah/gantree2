import { describe, expect, it } from "vitest";
import { allPlugins } from "@/harness/plugins";
import { toolCatalog } from "@/lib/agents/catalog";

describe("toolCatalog", () => {
  it("lists each in-process plugin, with oauth only on the redirect plugins", () => {
    const tools = toolCatalog();
    expect(tools.map((tool) => tool.id)).toEqual(allPlugins.map((plugin) => plugin.name));
    expect(tools.filter((tool) => tool.oauth).map((tool) => tool.id)).toEqual([
      "strava",
      "google-health",
      "google",
    ]);
    expect(tools.find((tool) => tool.id === "garmin")).toMatchObject({
      oauth: false,
      binary: "garmin",
      needs: ["GARMIN_EMAIL", "GARMIN_PASSWORD"],
      homeOnly: false,
    });
    expect(tools.find((tool) => tool.id === "google")?.needs).toEqual([
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
    ]);
    expect(tools.find((tool) => tool.id === "feeds")?.needs).toEqual([]);
    expect(tools.find((tool) => tool.id === "image")?.needs).toEqual([]);
    expect(tools.find((tool) => tool.id === "math")?.needs).toEqual([]);
    expect(tools.find((tool) => tool.id === "chat")?.needs).toEqual([]);
    expect(tools.every((tool) => tool.needs.includes("GARMIN_TOOL_TIER"))).toBe(false);
    expect(tools.every((tool) => tool.needs.includes("GOOGLE_TOOL_PRESET"))).toBe(false);
    expect(tools.every((tool) => tool.homeOnly === false)).toBe(true);
  });

  it("copies needs so a caller cannot edit the catalog", () => {
    const first = toolCatalog().find((tool) => tool.id === "garmin");
    first?.needs.push("NOPE");
    expect(toolCatalog().find((tool) => tool.id === "garmin")?.needs).toEqual(["GARMIN_EMAIL", "GARMIN_PASSWORD"]);
  });
});

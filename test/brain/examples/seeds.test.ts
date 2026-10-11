import {
  defaultSeeds,
  eligible,
  fallbackFormat,
  offHint,
  pickFrom,
  polishPrompt,
  serverPrefixes,
  type NamedTool,
  type Seed,
} from "@/brain/examples/seeds";
import { describe, expect, it } from "vitest";

function ids(seeds: Seed[]): Set<string> {
  return new Set(seeds.map((seed) => seed.id));
}

function tools(...names: string[]): NamedTool[] {
  return names.map((name) => ({ name }));
}

describe("seeds", () => {
  it("filters by live server prefixes", () => {
    const seeds: Seed[] = [
      { id: "g", title: "G", servers: ["google"], steps: ["a"] },
      { id: "gs", title: "GS", servers: ["google", "web_search"], steps: ["a"] },
      { id: "st", title: "ST", servers: ["strava"], steps: ["a"] },
    ];
    const defs = tools("google__calendar_list_events", "web_search", "memory_recall");
    const live = serverPrefixes(defs);
    expect(live.has("google")).toBe(true);
    expect(live.has("web_search")).toBe(true);
    expect(live.has("strava")).toBe(false);
    const elig = eligible(seeds, live);
    expect(elig).toHaveLength(2);
    expect(elig.some((seed) => seed.id === "st")).toBe(false);
    const got = pickFrom(seeds, defs);
    expect(got?.id === "g" || got?.id === "gs").toBe(true);
  });

  it("does not pick from an empty pool", () => {
    expect(pickFrom([], null)).toBeNull();
  });

  it("matches a harness seed against a zero-MCP catalog", () => {
    const got = pickFrom(defaultSeeds, null);
    expect(got).not.toBeNull();
    expect(got?.servers).toEqual([]);
  });

  it("keeps harness seeds eligible with no servers connected", () => {
    expect(defaultSeeds).toHaveLength(38);
    const have = ids(eligible(defaultSeeds, new Set()));
    for (const want of ["first-aim", "cron-reminder", "memory-skill", "mcp-enable"]) {
      expect(have.has(want), want).toBe(true);
    }
    expect(have.has("math-eval")).toBe(false);
    expect(have.has("google-calendar-contact")).toBe(false);
  });

  it("polishes a seed and falls back with the off hint", () => {
    const seed: Seed = { id: "x", title: "Demo title", servers: ["google"], steps: ["step one", "step two"] };
    const prompt = polishPrompt(seed);
    expect(prompt).toContain("Demo title");
    expect(prompt).toContain("step one");
    expect(prompt).toContain(offHint);
    expect(prompt).toContain("cron_schedule");
    expect(prompt).toContain("watch_add");
    expect(prompt).toContain("[location]");
    expect(prompt).toContain("self_note");
    expect(prompt).toContain("mcp_enable");
    const fallback = fallbackFormat(seed);
    expect(fallback).toContain("Demo title");
    expect(fallback).toContain(offHint);
  });

  it("splits Google Health from Garmin", () => {
    const crystal = serverPrefixes(tools(
      "google__calendar_list_events",
      "ghealth__sleep_get",
      "strava__activities_list",
      "strava__activities_update",
    ));
    const crystalIds = ids(eligible(defaultSeeds, crystal));
    for (const want of [
      "morning-brief",
      "morning-brief-ghealth",
      "evening-winddown",
      "weekly-training-strava",
      "weekly-training-ghealth",
      "ghealth-strava-enrich",
      "ghealth-sleep",
      "fitness-recovery-ghealth",
    ]) {
      expect(crystalIds.has(want), want).toBe(true);
    }
    for (const ban of ["morning-brief-garmin", "garmin-sleep", "garmin-strava-enrich", "fitness-recovery-garmin"]) {
      expect(crystalIds.has(ban), ban).toBe(false);
    }

    const garmin = serverPrefixes(tools(
      "garmin__sleep_get",
      "garmin__activities_get",
      "strava__activities_list",
      "strava__activities_update",
    ));
    const garminIds = ids(eligible(defaultSeeds, garmin));
    expect(garminIds.has("garmin-strava-enrich")).toBe(true);
    expect(garminIds.has("weekly-training-strava")).toBe(true);
    expect(garminIds.has("ghealth-strava-enrich")).toBe(false);
  });

  it("matches maps seeds only when maps is live", () => {
    const have = ids(eligible(defaultSeeds, serverPrefixes(tools("maps__place_search", "maps__route_eta"))));
    expect(have.has("maps-near-me")).toBe(true);
    expect(have.has("maps-route-eta")).toBe(true);
    expect(have.has("feeds-nws-watch")).toBe(false);
  });

  it("matches the image seed only when image is live", () => {
    const have = ids(eligible(defaultSeeds, serverPrefixes(tools("image__photo_generate", "image__photo_edit"))));
    expect(have.has("image-photo-generate")).toBe(true);
    expect(have.has("maps-near-me")).toBe(false);
  });

  it("keeps feeds and twitter watches apart", () => {
    const feeds = ids(eligible(defaultSeeds, serverPrefixes(tools("feeds__items_list", "feeds__source_resolve"))));
    expect(feeds.has("feeds-nws-watch")).toBe(true);
    expect(feeds.has("twitter-watch")).toBe(false);
    const twitter = ids(eligible(defaultSeeds, serverPrefixes(tools("twitter__posts_list"))));
    expect(twitter.has("twitter-watch")).toBe(true);
    expect(twitter.has("feeds-nws-watch")).toBe(false);
  });

  it("matches math, search, and strava seeds by their own servers", () => {
    const math = ids(eligible(defaultSeeds, serverPrefixes(tools("math__expression_evaluate"))));
    expect(math.has("math-eval")).toBe(true);
    expect(math.has("first-aim")).toBe(true);
    expect(math.has("math-sheets")).toBe(false);

    const search = ids(eligible(defaultSeeds, serverPrefixes(tools("web_search"))));
    expect(search.has("search-decide")).toBe(true);
    expect(search.has("search-calendar-event")).toBe(false);

    const strava = ids(eligible(defaultSeeds, serverPrefixes(tools("strava__activities_list"))));
    expect(strava.has("strava-last")).toBe(true);
    expect(strava.has("fitness-recovery-garmin")).toBe(false);
  });
});

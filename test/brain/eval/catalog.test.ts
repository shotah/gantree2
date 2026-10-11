import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLiveCatalog, mergeLiveTools, parseMcpServers } from "@/brain/eval/catalog";
import { fixtureDir, loadEvalFixtures } from "@/brain/eval/fixture";

describe("eval live catalog", () => {
  it("reads the mcp.toml allowlist", () => {
    const servers = parseMcpServers(readFileSync(join(fixtureDir, "mcp.toml"), "utf8"));
    expect(servers.map((server) => server.name)).toEqual(["rentals", "flights", "google"]);
    expect(servers.find((server) => server.name === "google")?.tools).toEqual([
      "calendar_list_events",
      "calendar_create_events",
    ]);
  });

  it("publishes plugin schemas, and only the google tools the manifest allows", () => {
    const names = loadLiveCatalog().map((tool) => tool.name);
    expect(names).toContain("rentals__listings_search");
    expect(names).toContain("rentals__listings_get");
    expect(names).toContain("flights__offers_search");
    expect(names).toContain("flights__dates_search");
    expect(names).toContain("google__calendar_list_events");
    expect(names).toContain("google__calendar_create_events");
    expect(names.some((name) => name.startsWith("google__gmail"))).toBe(false);
    expect(names.some((name) => name.startsWith("google__calendar_delete"))).toBe(false);
  });

  it("attaches canned results for the tools_from fixtures", () => {
    const live = loadLiveCatalog();
    const fixtures = loadEvalFixtures();
    const denver = fixtures.find((fx) => fx.name === "denver_flight");
    const rental = fixtures.find((fx) => fx.name === "rental_daily_cron");
    expect(denver).toBeDefined();
    expect(rental).toBeDefined();
    if (!denver || !rental) {
      return;
    }
    const flights = mergeLiveTools(live, denver.toolsFrom, denver.tools);
    const offers = flights.find((tool) => tool.name === "flights__offers_search");
    expect(offers?.description.length).toBeGreaterThan(0);
    expect(offers?.result).toContain("189");
    const search = mergeLiveTools(live, rental.toolsFrom, rental.tools).find((tool) => tool.name === "rentals__listings_search");
    expect(search?.result).toContain("Ballard");
    expect(() => mergeLiveTools(live, ["rentals"], [{ name: "rentals__search", description: "", result: "[]" }])).toThrow(
      /rentals__search/,
    );
  });
});

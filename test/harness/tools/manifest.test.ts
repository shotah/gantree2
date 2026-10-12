import { describe, expect, it } from "vitest";
import { memorySink } from "@/harness/core/log";
import { Registry } from "@/harness/tools/registry";
import { checkManifest, diffToolNames, formatDrift, parseHostManifest } from "@/harness/tools/manifest";
import { echoTool, fakePlugin, memSql, testClock, testContext } from "./fixture";

describe("diffToolNames", () => {
  it("returns each side's extras, sorted", () => {
    expect(diffToolNames(["account_get", "listings_search"], ["listings_search", "link_format"])).toEqual({
      onlyManifest: ["account_get"],
      onlyRegistry: ["link_format"],
    });
    expect(diffToolNames(["a", "b"], ["b", "a"])).toEqual({ onlyManifest: [], onlyRegistry: [] });
  });
});

describe("formatDrift", () => {
  it("matches the Go drift line", () => {
    const msg = formatDrift("maps", [], ["place_search", "route_eta"], true);
    for (const want of [
      "maps: drift",
      "host-manifest has no tools field",
      "only in host-manifest: (none)",
      "only in tools/list: place_search, route_eta",
    ]) {
      expect(msg).toContain(want);
    }
  });
});

describe("parseHostManifest", () => {
  it("accepts a tools-less document, a string list, and name objects", () => {
    const rentals = parseHostManifest("{\"name\":\"rentals\",\"command\":\"rentals-search-mcp\",\"env_keys\":[\"RENTCAST_API_KEY\"],\"blurb\":\"US listings.\"}");
    expect(rentals.hasTools).toBe(false);
    expect(rentals.name).toBe("rentals");
    expect(rentals.command).toBe("rentals-search-mcp");
    expect(rentals.tools).toEqual([]);

    const maps = parseHostManifest("noise\n" + "{\"name\":\"maps\",\"command\":\"google-maps-mcp\",\"args\":[\"--preset\",\"everyday\"],\"tools\":[\"place_search\",\"route_eta\"]}");
    expect(maps.hasTools).toBe(true);
    expect(maps.args).toEqual(["--preset", "everyday"]);
    expect(maps.tools).toEqual(["place_search", "route_eta"]);

    const math = parseHostManifest("{\"name\":\"math\",\"command\":\"mcp-go-math\",\"tools\":[{\"name\":\"units_convert\"},{\"name\":\"expression_evaluate\"}]}");
    expect(math.tools).toEqual(["expression_evaluate", "units_convert"]);

    expect(() => parseHostManifest("{\"tools\":{\"no\":\"array\"}}")).toThrow(/tools/);
  });
});

describe("checkManifest", () => {
  it("reports suffixes the manifest and the registry do not share", async () => {
    const registry = new Registry(
      [
        fakePlugin("maps", [echoTool("place_search"), echoTool("route_eta")]),
        fakePlugin("math", [echoTool("expression_evaluate")]),
      ],
      testContext(memSql(), testClock(), memorySink()),
      { dynamicTools: false },
    );
    await registry.publish();
    expect(registry.originalNames("maps")).toEqual(["place_search", "route_eta"]);

    const drift = checkManifest(registry, [
      parseHostManifest("{\"name\":\"maps\",\"tools\":[\"place_search\",\"route_eta\"]}"),
      parseHostManifest("{\"name\":\"math\",\"tools\":[\"units_convert\"]}"),
      { name: "rentals", command: "rentals-search-mcp", args: [], tools: [], hasTools: false },
    ]);
    expect(drift.map((row) => row.server)).toEqual(["math", "rentals"]);
    expect(drift[0]).toMatchObject({
      onlyManifest: ["units_convert"],
      onlyRegistry: ["expression_evaluate"],
      toolsFieldAbsent: false,
    });
    expect(drift[1]).toMatchObject({ toolsFieldAbsent: true, onlyManifest: [], onlyRegistry: [] });
  });
});

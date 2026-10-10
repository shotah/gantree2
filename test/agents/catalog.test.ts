import { describe, expect, it } from "vitest";
import { toolCatalog } from "@/lib/agents/catalog";
import { loadLock, type LockRow } from "@/lib/agents/lock";

describe("toolCatalog", () => {
  it("follows the lock, with oauth only on the paste-flow plugins", () => {
    const tools = toolCatalog();
    expect(tools.map((tool) => tool.id)).toEqual(loadLock().map((row) => row.id));
    expect(tools.filter((tool) => tool.oauth).map((tool) => tool.id)).toEqual([
      "google",
      "google-health",
      "strava",
    ]);
    expect(tools.find((tool) => tool.id === "garmin")).toMatchObject({
      oauth: false,
      binary: "garmin",
      needs: ["GARMIN_EMAIL", "GARMIN_PASSWORD"],
      homeOnly: false,
    });
    expect(tools.find((tool) => tool.id === "image")?.needs).toEqual([]);
    expect(tools.every((tool) => tool.homeOnly === false)).toBe(true);
  });

  it("copies needs and reads homeOnly from the row", () => {
    const row: LockRow = {
      id: "cast",
      path: "./mcp/cast",
      module: "github.com/shotah/mcp-beam",
      binary: "mcp-beam",
      needs: ["LAN"],
      homeOnly: true,
    };
    const [tool] = toolCatalog([row]);
    expect(tool).toEqual({
      id: "cast",
      binary: "mcp-beam",
      needs: ["LAN"],
      oauth: false,
      homeOnly: true,
    });
    tool?.needs.push("NOPE");
    expect(row.needs).toEqual(["LAN"]);
  });
});

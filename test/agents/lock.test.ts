import { describe, expect, it } from "vitest";
import { loadLock, parseLock } from "@/lib/agents/lock";

const ROW = "maps\t./mcp/maps\tgithub.com/shotah/google-maps-mcp\tgoogle-maps-mcp\tGOOGLE_MAPS_API_KEY";

describe("parseLock", () => {
  it("reads tab rows, dash needs, and comma lists", () => {
    const rows = parseLock(`# comment\n\n${ROW}\nmath\t./mcp/math\tgithub.com/shotah/mcp-go-math\tmcp-go-math\t-\n`);
    expect(rows.map((row) => row.id)).toEqual(["maps", "math"]);
    expect(rows[0]).toMatchObject({
      path: "./mcp/maps",
      module: "github.com/shotah/google-maps-mcp",
      binary: "google-maps-mcp",
      needs: ["GOOGLE_MAPS_API_KEY"],
      homeOnly: false,
    });
    expect(rows[1]?.needs).toEqual([]);
  });

  it("splits needs and accepts a home_only column", () => {
    const text = [
      "google\t./mcp/google\tgithub.com/shotah/google-mcp\tgoogle-mcp\tGOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,,",
      "cast\t./mcp/cast\tgithub.com/shotah/mcp-beam\tmcp-beam\t-\thome_only",
      "lan\t./mcp/lan\tgithub.com/shotah/lan\tlan\t-\tTRUE",
      "yes\t./mcp/yes\tgithub.com/shotah/yes\tyes\t-\tyes",
      "one\t./mcp/one\tgithub.com/shotah/one\tone\t-\t1",
      "off\t./mcp/off\tgithub.com/shotah/off\toff\t-\tfalse",
      "nope\t./mcp/nope\tgithub.com/shotah/nope\tnope\t-\tno",
    ].join("\n");
    const rows = parseLock(text);
    expect(rows[0]?.needs).toEqual(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]);
    expect(rows.map((row) => row.homeOnly)).toEqual([false, true, true, true, true, false, false]);
  });

  it("accepts CRLF and a trailing home_only cell", () => {
    const rows = parseLock(`${ROW}\thome_only\r\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.homeOnly).toBe(true);
  });

  it("throws when a data line has the wrong shape", () => {
    expect(() => parseLock("only-three\tcols\there")).toThrow(/mcp.lock:1: expected 5 or 6 columns/);
    expect(() => parseLock(`${ROW}\textra\tnope`)).toThrow(/expected 5 or 6 columns/);
    expect(() => parseLock("\t./mcp/math\tmod\tbin\t-")).toThrow(/id, path, module, and binary are required/);
    expect(() => parseLock("id\t\tmod\tbin\t-")).toThrow(/required/);
  });
});

describe("loadLock", () => {
  it("loads harness/mcp.lock in file order", () => {
    const rows = loadLock();
    expect(rows.map((row) => row.id)).toEqual([
      "math",
      "maps",
      "image",
      "chat",
      "google",
      "google-health",
      "garmin",
      "strava",
      "feeds",
      "twitter",
      "rentals",
    ]);
    expect(rows.every((row) => row.homeOnly === false)).toBe(true);
    expect(rows.find((row) => row.id === "maps")?.needs).toEqual(["GOOGLE_MAPS_API_KEY"]);
    expect(rows.find((row) => row.id === "math")?.needs).toEqual([]);
    expect(rows.find((row) => row.id === "google")?.binary).toBe("google-mcp");
    expect(rows.find((row) => row.id === "chat")?.path).toBe("./mcp/chat");
  });
});

import { describe, expect, it } from "vitest";
import { missingKeys } from "@/lib/agents/needs";
import type { Grant, ToolEntry } from "@/lib/agents/types";

const catalog: ToolEntry[] = [
  { id: "maps", binary: "google-maps-mcp", needs: ["GOOGLE_MAPS_API_KEY"], oauth: false, homeOnly: false },
  { id: "google", binary: "google-mcp", needs: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], oauth: true, homeOnly: false },
  { id: "math", binary: "mcp-go-math", needs: [], oauth: false, homeOnly: false },
  { id: "image", binary: "image-generation-mcp", needs: ["IMAGE_API_KEY", "IMAGE_MODEL"], oauth: false, homeOnly: false },
];

describe("missingKeys", () => {
  it("nags only granted tools, in grant order, for keys the catalog still wants", () => {
    const grants: Grant[] = [
      { name: "image", command: "image-generation-mcp" },
      { name: "maps", command: "google-maps-mcp" },
      { name: "unknown", command: "nope" },
      { name: "math", command: "mcp-go-math" },
    ];
    expect(missingKeys(grants, ["IMAGE_MODEL"], catalog)).toEqual([
      { id: "image", keys: ["IMAGE_API_KEY"] },
      { id: "maps", keys: ["GOOGLE_MAPS_API_KEY"] },
    ]);
  });

  it("treats grant env entries as already forwarded", () => {
    const grants: Grant[] = [
      { name: "google", command: "google-mcp", env: ["GOOGLE_OAUTH_CLIENT_ID=id", " =ignored", "GOOGLE_OAUTH_CLIENT_SECRET"] },
      { name: "maps", command: "google-maps-mcp", env: [" FOO=bar"] },
    ];
    expect(missingKeys(grants, [], catalog)).toEqual([
      { id: "maps", keys: ["GOOGLE_MAPS_API_KEY"] },
    ]);
  });

  it("is empty when nothing is granted or every key is present", () => {
    expect(missingKeys([], ["GOOGLE_MAPS_API_KEY"], catalog)).toEqual([]);
    const grants: Grant[] = [{ name: "maps", command: "google-maps-mcp", env: ["GOOGLE_MAPS_API_KEY=x"] }];
    expect(missingKeys(grants, [], catalog)).toEqual([]);
  });
});

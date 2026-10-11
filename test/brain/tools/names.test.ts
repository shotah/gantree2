import { describe, expect, it } from "vitest";
import { hyphenatePrefix, prefixedName, uniqueSorted } from "@/brain/tools/names";

describe("prefixedName", () => {
  it("sanitizes server and tool into server__tool", () => {
    expect(prefixedName("google-workspace", "gmail.search")).toBe("google-workspace__gmail_search");
  });

  it("rejects an empty side and a name over 64 UTF-8 bytes", () => {
    expect(() => prefixedName("  ", "echo")).toThrow(/empty tool name/);
    expect(() => prefixedName("demo", "")).toThrow(/empty tool name/);
    const suffix = "a".repeat(59);
    expect(() => prefixedName("demo", suffix)).toThrow(/exceeds 64/);
    expect(prefixedName("demo", "a".repeat(58)).length).toBe(64);
  });
});

describe("uniqueSorted", () => {
  it("trims, drops blanks and duplicates, and sorts", () => {
    expect(uniqueSorted(["place_search", " route_eta ", "place_search", " "])).toEqual(["place_search", "route_eta"]);
  });
});

describe("hyphenatePrefix", () => {
  it("rewrites only the server prefix", () => {
    expect(hyphenatePrefix("google_search__web_search")).toBe("google-search__web_search");
    expect(hyphenatePrefix("google-search__web_search")).toBeNull();
    expect(hyphenatePrefix("web_search")).toBeNull();
  });
});

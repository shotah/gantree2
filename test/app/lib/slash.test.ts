import { describe, expect, it } from "vitest";
import { matchSlash, slashInsert, slashToken, type SlashCommand } from "@/app/lib/slash";

const catalog: SlashCommand[] = [
  { name: "new", hint: "reset this session" },
  { name: "tools", hint: "prefixed tool catalog" },
  { name: "toolstats", hint: "per-tool call ledger" },
  { name: "tokens", hint: "prompt token breakdown" },
  { name: "brief", hint: "hold a prefix ~6h", args: true },
];

describe("slash", () => {
  it("treats a leading / token as a draft until a space", () => {
    expect(slashToken("")).toBeNull();
    expect(slashToken("hello")).toBeNull();
    expect(slashToken("/")).toBe("");
    expect(slashToken("/to")).toBe("to");
    expect(slashToken("/NEW")).toBe("new");
    expect(slashToken("/new ")).toBeNull();
    expect(slashToken("/brief google")).toBeNull();
  });

  it("filters a caller-supplied catalog and inserts a trailing space for args", () => {
    expect(matchSlash("hello", catalog)).toEqual([]);
    expect(matchSlash("/", catalog).map((c) => c.name)).toEqual(catalog.map((c) => c.name));
    expect(matchSlash("/to", catalog).map((c) => c.name)).toEqual(["tools", "toolstats", "tokens"]);
    expect(matchSlash("/new", catalog).map((c) => c.name)).toEqual(["new"]);
    expect(matchSlash("/xyz", catalog)).toEqual([]);
    const brief = catalog.find((c) => c.name === "brief");
    const neu = catalog.find((c) => c.name === "new");
    expect(brief && slashInsert(brief)).toBe("/brief ");
    expect(neu && slashInsert(neu)).toBe("/new");
  });
});

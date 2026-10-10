import { describe, expect, it } from "vitest";
import { MARK_ORANGE, pathData, TREE_PATH } from "@/lib/theme/mark";

describe("mark", () => {
  it("reads the one path out of the traced tree", () => {
    expect(TREE_PATH.startsWith("M7057 12760")).toBe(true);
    expect(TREE_PATH.endsWith("z")).toBe(true);
    expect(TREE_PATH).not.toContain("\n");
  });

  it("returns an empty string when there is no path", () => {
    expect(pathData("<svg></svg>")).toBe("");
    expect(pathData('<svg><path d="M0 0 L1 1"/></svg>')).toBe("M0 0 L1 1");
  });

  it("hangs the orange on the right bough inside the 64-box", () => {
    expect(MARK_ORANGE.x).toBeLessThan(64);
    expect(MARK_ORANGE.cy + MARK_ORANGE.r).toBeLessThan(64);
    expect(MARK_ORANGE.stringTop).toBeLessThan(MARK_ORANGE.stringBottom);
  });
});

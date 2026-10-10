import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("sw.js lock-screen", () => {
  it("skips the tray when a window is visible", () => {
    expect(src).toContain("visibilityState === \"visible\"");
    expect(src).toContain("addEventListener(\"push\"");
  });

  it("still shows a round-trip test card with the app in front", () => {
    expect(src).toContain("test = parsed.test === true");
    expect(src).toContain("if (!test && windows.some((c) => c.visibilityState === \"visible\"))");
  });

  it("groups on the product tag, not the old one", () => {
    expect(src).toContain("let tag = \"gantree\"");
    expect(src).not.toMatch(/pendant/i);
  });
});

import { describe, expect, it } from "vitest";
import { parseCommands } from "@/lib/chat/cmds";
import { catalog, helpText, readyLine } from "@/harness/slash";

describe("slash catalog", () => {
  it("is unique, matches /help, and round-trips the cmds frame", () => {
    const cmds = catalog();
    expect(cmds.length).toBeGreaterThanOrEqual(10);
    const seen = new Set<string>();
    const help = helpText();
    for (const c of cmds) {
      expect(c.name).not.toBe("");
      expect(c.name).not.toContain("/");
      expect(c.name).not.toContain(" ");
      expect(c.hint.length).toBeGreaterThanOrEqual(3);
      expect(seen.has(c.name)).toBe(false);
      seen.add(c.name);
      expect(help).toContain(`/${c.name} —`);
    }
    expect(seen.has("new")).toBe(true);
    expect(seen.has("brief")).toBe(true);
    expect(seen.has("help")).toBe(true);
    const ready = readyLine();
    expect(ready).toContain("/new");
    expect(ready.endsWith("/quit")).toBe(true);
    expect(parseCommands(cmds)).toEqual(cmds);
  });
});

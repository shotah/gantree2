import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES, themeOf } from "@/lib/theme/catalog";
// Node runs scripts/*.ts natively (type stripping), so the extension stays.
import { json, kotlin, main, swift, tokenKeys } from "../../scripts/theme-export.ts";

describe("theme-export", () => {
  it("json carries every theme and every token", () => {
    const j = JSON.parse(json()) as { default: string; themes: Array<{ id: string; tokens: Record<string, string> }> };
    expect(j.default).toBe("boom");
    expect(j.themes.map((t) => t.id)).toEqual(THEMES.map((t) => t.id));
    expect(j.themes[0].tokens.canvas).toBe("#0e1316");
    expect(Object.keys(j.themes[0].tokens).sort()).toEqual(Object.keys(THEMES[0].tokens).sort());
  });

  it("kotlin: Compose ARGB, one entry per theme, default and lookup", () => {
    const kt = kotlin(THEMES, "com.gantree.cab.theme");
    expect(kt).toContain("package com.gantree.cab.theme");
    expect(kt).toContain("canvas = Color(0xFF0E1316)");
    expect(kt).toContain("accent = Color(0xFFF07848)");
    expect(kt).toContain(`you = Color(0xFF${themeOf("siren").tokens.you.slice(1).toUpperCase()})`);
    expect(kt).toContain('const val DEFAULT = "boom"');
    for (const t of THEMES) {
      expect(kt).toContain(`"${t.id}" to GantreeTheme(`);
    }
    for (const k of tokenKeys()) {
      expect(kt).toContain(`  val ${k}: Color,`);
    }
    expect(kt).not.toContain("#");
  });

  it("swift: opaque RGB UInt32, same shape", () => {
    const sw = swift();
    expect(sw).toContain("canvas: 0x0E1316,");
    expect(sw).toContain("accent: 0xF07848,");
    expect(sw).toContain('public static let defaultId = "boom"');
    expect(sw).toContain('"flicker": GantreeTheme(');
    expect((sw.match(/GantreeTheme\(/g) ?? []).length).toBe(THEMES.length);
  });

  it("writes three files", () => {
    const dir = mkdtempSync(join(tmpdir(), "theme-"));
    const files = main([dir]);
    expect(files.map((f) => f.replace(`${dir}/`, ""))).toEqual(["tokens.json", "GantreeThemes.kt", "GantreeThemes.swift"]);
    expect(readFileSync(files[1], "utf8")).toContain("package com.gantree.theme");
    expect(() => main([])).toThrow(/usage/);
  });
});

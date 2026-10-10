/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  applyTheme,
  cacheRoomTheme,
  cachedRoomTheme,
  DEFAULT_THEME,
  paintTheme,
  parseTheme,
  ROOM_THEME_KEY,
  THEME_BOOT,
  THEME_KEY,
  themeCss,
  themeFromQuery,
  themeOf,
  THEMES,
} from "@/app/lib/theme";
import { FOLLOW_THEME_PREF_KEY } from "@/app/lib/prefs";

const IDS = [
  "boom",
  "paper",
  "ink",
  "marquee",
  "lemonade",
  "neon",
  "fizz",
  "rain",
  "mist",
  "fuse",
  "grit",
  "siren",
  "flare",
  "static",
  "flicker",
] as const;

describe("theme", () => {
  it("falls back to boom, including a retired id", () => {
    expect(parseTheme(undefined)).toBe(DEFAULT_THEME);
    expect(parseTheme("nope")).toBe("boom");
    expect(parseTheme("noir")).toBe("boom");
    expect(parseTheme("paper")).toBe("paper");
    expect(themeFromQuery("marquee")).toBe("marquee");
    expect(themeFromQuery("siren")).toBe("siren");
    expect(themeFromQuery("lamp")).toBeNull();
    expect(themeFromQuery("noir")).toBeNull();
    expect(themeFromQuery(null)).toBeNull();
  });

  it("ships Boom, Paper, Ink, and a mood dozen", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...IDS]);
    const css = themeCss();
    expect(css).toContain(':root,[data-theme="boom"]');
    expect(css).toContain("color-scheme:dark");
    expect(css).toContain("color-scheme:light");
    const keys = Object.keys(THEMES[0].tokens).sort();
    for (const t of THEMES) {
      expect(Object.keys(t.tokens).sort()).toEqual(keys);
      expect(css).toContain(`[data-theme="${t.id}"]`);
      expect(css).toContain(`--canvas:${t.tokens.canvas}`);
      expect(css).toContain(`--you:${t.tokens.you}`);
      expect(css).toContain(`color-scheme:${t.tokens.scheme}`);
    }
    expect(themeOf("paper").tokens.scheme).toBe("light");
    expect(themeOf("neon").tokens.scheme).toBe("dark");
    expect(THEME_BOOT).toContain(THEME_KEY);
    expect(THEME_BOOT).toContain(ROOM_THEME_KEY);
    expect(THEME_BOOT).toContain(FOLLOW_THEME_PREF_KEY);
    expect(themeOf("boom").tokens.canvas).toBe("#0e1316");
    expect(themeOf("boom").tokens.accent).toBe("#f07848");
  });

  it("storage keys moved to the gantree namespace", () => {
    expect(THEME_KEY).toBe("gantree.theme");
    expect(ROOM_THEME_KEY).toBe("gantree.roomTheme");
    expect(FOLLOW_THEME_PREF_KEY).toBe("gantree.followTheme");
  });

  it("paints a room theme without claiming the human's pick", () => {
    localStorage.setItem(THEME_KEY, "boom");
    paintTheme("siren");
    expect(document.documentElement.getAttribute("data-theme")).toBe("siren");
    expect(localStorage.getItem(THEME_KEY)).toBe("boom");
    applyTheme("paper");
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    expect(localStorage.getItem(THEME_KEY)).toBe("paper");
    applyTheme("paper");
    applyTheme("neon");
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
  });

  it("caches the last room theme for boot", () => {
    cacheRoomTheme("rain");
    expect(localStorage.getItem(ROOM_THEME_KEY)).toBe("rain");
    expect(cachedRoomTheme()).toBe("rain");
    localStorage.setItem(ROOM_THEME_KEY, "lamp");
    expect(cachedRoomTheme()).toBeNull();
    cacheRoomTheme(null);
    expect(cachedRoomTheme()).toBeNull();
  });
});

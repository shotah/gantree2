import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, knownTheme, parseTheme, themeCards, themeIdList, themeOf, THEMES, type ThemeFeel } from "@/lib/theme/catalog";
import { themeContrastFails } from "@/lib/theme/contrast";

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

const FEELS = ["happy", "excited", "sad", "frustrated", "angry", "anxious"] as const satisfies readonly ThemeFeel[];

/**
 * Boom shares its hexes with gantree. These two pairs miss AA until gantree
 * raises `dim` and `faint`; drop the exemption and copy the hexes when it does.
 * `dim` on `kit` is 4.40 (min 4.5). `faint` on `panel` is 2.86 (min 3).
 */
const BOOM_EXEMPT = new Set(["dim on kit", "faint on panel"]);

describe("theme catalog", () => {
  it("keeps Boom hexes, retires the other neutrals, and adds a mood dozen", () => {
    expect(THEMES.map((t) => t.id)).toEqual([...IDS]);
    expect(themeOf("boom").tokens.canvas).toBe("#0e1316");
    expect(themeOf("boom").tokens.accent).toBe("#f07848");
    expect(themeOf("paper").tokens.scheme).toBe("light");
    expect(themeOf("paper").tokens.accent).toBe("#c24a28");
    expect(themeOf("ink").tokens.scheme).toBe("dark");
    expect(themeOf("ink").tokens.accent).toBe("#f0b020");
    expect(themeOf("marquee").tokens.canvas).toBe("#141a3c");
    expect(themeOf("marquee").tokens.accent).toBe("#ffcc33");
    expect(themeOf("lemonade").tokens.accent).toBe("#1f52e0");
    expect(themeOf("neon").tokens.accent).toBe("#ff2d95");
    expect(themeOf("siren").tokens.you).toBe("#3a0e18");
    expect(themeOf("flicker").tokens.scheme).toBe("light");
    expect(parseTheme("paper")).toBe("paper");
    expect(parseTheme("siren")).toBe("siren");
    expect(parseTheme("noir")).toBe(DEFAULT_THEME);
    expect(parseTheme("lamp")).toBe(DEFAULT_THEME);
    expect(knownTheme("marquee")).toBe("marquee");
    expect(knownTheme("noir")).toBeNull();
    expect(knownTheme("inlay")).toBeNull();
    expect(knownTheme("chalk")).toBeNull();
    expect(themeOf("nope" as "boom").id).toBe("boom");
  });

  it("gives every feeling one dark id and one light id", () => {
    expect(THEMES.filter((t) => t.feel === "neutral").map((t) => t.id)).toEqual(["boom", "paper", "ink"]);
    for (const feel of FEELS) {
      const pair = THEMES.filter((t) => t.feel === feel);
      expect(pair.map((t) => t.tokens.scheme)).toEqual(["dark", "light"]);
    }
  });

  it("cards are id + feel + scheme + mood + the two signature hexes", () => {
    const cards = themeCards();
    expect(cards).toHaveLength(THEMES.length);
    for (const t of THEMES) {
      expect(t.mood.startsWith(`${t.feel}, ${t.tokens.scheme} — `)).toBe(true);
      expect(t.mood.includes(t.tokens.canvas)).toBe(false);
      const card = cards.find((c) => c.id === t.id);
      expect(card).toEqual({
        id: t.id,
        label: t.label,
        feel: t.feel,
        scheme: t.tokens.scheme,
        mood: t.mood,
        canvas: t.tokens.canvas,
        accent: t.tokens.accent,
      });
    }
    expect(themeIdList()).toEqual(THEMES.map((t) => t.id));
  });

  it("every theme meets AA on the painted pairs", () => {
    const fails = THEMES.flatMap((t) => themeContrastFails(t))
      .filter((f) => !(f.id === "boom" && BOOM_EXEMPT.has(f.pair)));
    expect(fails).toEqual([]);
  });

  it("boom stays exempt from two pairs until gantree moves the shared hexes", () => {
    const fails = themeContrastFails(themeOf("boom")).map((f) => f.pair);
    expect(fails).toEqual(["dim on kit", "faint on panel"]);
  });
});

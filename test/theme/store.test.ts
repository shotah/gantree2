import { describe, expect, it } from "vitest";
import { themeCards } from "@/lib/theme/catalog";
import { encodeThemeNotice, encodeThemeState, isThemeNotice, parseThemeWrite, themeIdFromUnknown } from "@/lib/theme/store";

describe("parseThemeWrite", () => {
  it("accepts a known id and refuses junk", () => {
    expect(parseThemeWrite({ theme: "siren" })).toEqual({ ok: true, theme: "siren" });
    expect(parseThemeWrite({ theme: "nope" })).toEqual({ ok: false, detail: "bad theme" });
    expect(parseThemeWrite({ theme: "noir" })).toEqual({ ok: false, detail: "bad theme" });
    expect(parseThemeWrite({ theme: "boom", extra: 1 }).ok).toBe(true);
    expect(parseThemeWrite(null).ok).toBe(false);
    expect(parseThemeWrite("siren").ok).toBe(false);
  });
});

describe("theme notice", () => {
  it("carries the id and no text, so a client that does not know it drops it", () => {
    const wire = encodeThemeNotice("siren");
    const raw = JSON.parse(wire) as Record<string, unknown>;
    expect(raw).toEqual({ kind: "theme", theme: "siren" });
    expect("text" in raw).toBe(false);
    expect("images" in raw).toBe(false);
  });

  it("round-trips an id, treats null as cleared, and ignores chat frames and junk", () => {
    expect(themeIdFromUnknown(JSON.parse(encodeThemeNotice("paper")))).toBe("paper");
    expect(themeIdFromUnknown(JSON.parse(encodeThemeNotice(null)))).toBe("");
    expect(themeIdFromUnknown({ kind: "theme", theme: "nope" })).toBeNull();
    expect(themeIdFromUnknown({ kind: "theme", theme: "noir" })).toBeNull();
    expect(themeIdFromUnknown({ kind: "theme", text: "paper" })).toBe("");
    expect(isThemeNotice({ kind: "theme", theme: "nope" })).toBe(true);
    expect(isThemeNotice({ kind: "reply", theme: "siren" })).toBe(false);
    expect(themeIdFromUnknown({ kind: "face", text: "42" })).toBeNull();
    expect(themeIdFromUnknown({ kind: "backdrop", rev: 1 })).toBeNull();
    expect(themeIdFromUnknown({ kind: "reply", text: "hi", theme: "siren" })).toBeNull();
    expect(themeIdFromUnknown(null)).toBeNull();
  });
});

describe("encodeThemeState", () => {
  it("GET body is current id plus the catalog cards", () => {
    const raw = JSON.parse(encodeThemeState("rain")) as { theme: string; themes: unknown[] };
    expect(raw.theme).toBe("rain");
    expect(raw.themes).toEqual(themeCards());
    expect(JSON.parse(encodeThemeState(null)).theme).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { FOLLOW_THEME_PREF_KEY, followThemePrefOn, writeFollowThemePref } from "@/app/lib/prefs";

describe("follow-theme pref", () => {
  it("defaults on; only the literal off turns it off", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(followThemePrefOn(null)).toBe(true);
    expect(followThemePrefOn(storage)).toBe(true);
    writeFollowThemePref(storage, false);
    expect(store.get(FOLLOW_THEME_PREF_KEY)).toBe("off");
    expect(followThemePrefOn(storage)).toBe(false);
    writeFollowThemePref(storage, true);
    expect(followThemePrefOn(storage)).toBe(true);
  });
});

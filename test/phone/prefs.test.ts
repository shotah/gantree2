import { describe, expect, it } from "vitest";
import {
  BACKDROP_PREF_KEY,
  backdropPrefOn,
  FOLLOW_THEME_PREF_KEY,
  followThemePrefOn,
  GEO_PREF_KEY,
  geoPrefOn,
  LANG_PREF_KEY,
  langPref,
  PHOTO_PREF_KEY,
  photoSizePref,
  VOICE_PREF_KEY,
  voicePrefOn,
  writeBackdropPref,
  writeFollowThemePref,
  writeGeoPref,
  writeLangPref,
  writePhotoSizePref,
  writeVoicePref,
} from "@/lib/phone/prefs";

function memStorage() {
  const mem = new Map<string, string>();
  return {
    mem,
    storage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    },
  };
}

describe("photo size pref", () => {
  it("defaults medium, round-trips, and shrugs off junk", () => {
    const { mem, storage } = memStorage();
    expect(photoSizePref(null)).toBe("medium");
    expect(photoSizePref(storage)).toBe("medium");
    writePhotoSizePref(storage, "small");
    expect(mem.get(PHOTO_PREF_KEY)).toBe("small");
    expect(photoSizePref(storage)).toBe("small");
    mem.set(PHOTO_PREF_KEY, "gigantic");
    expect(photoSizePref(storage)).toBe("medium");
  });
});

describe("geo pref", () => {
  it("defaults on and only treats off as disabled", () => {
    const { mem, storage } = memStorage();
    expect(geoPrefOn(null)).toBe(true);
    expect(geoPrefOn(storage)).toBe(true);
    writeGeoPref(storage, false);
    expect(mem.get(GEO_PREF_KEY)).toBe("off");
    expect(geoPrefOn(storage)).toBe(false);
    writeGeoPref(storage, true);
    expect(geoPrefOn(storage)).toBe(true);
  });
});

describe("backdrop pref", () => {
  it("defaults on (Kit's wallpaper shows) and only off hides it", () => {
    const { mem, storage } = memStorage();
    expect(backdropPrefOn(null)).toBe(true);
    expect(backdropPrefOn(storage)).toBe(true);
    writeBackdropPref(storage, false);
    expect(mem.get(BACKDROP_PREF_KEY)).toBe("off");
    expect(backdropPrefOn(storage)).toBe(false);
    writeBackdropPref(storage, true);
    expect(backdropPrefOn(storage)).toBe(true);
    expect(BACKDROP_PREF_KEY).toBe("gantree.backdrop");
  });
});

describe("follow theme pref", () => {
  it("defaults on (Kit's room theme paints) and only off keeps yours", () => {
    const { mem, storage } = memStorage();
    expect(followThemePrefOn(null)).toBe(true);
    expect(followThemePrefOn(storage)).toBe(true);
    writeFollowThemePref(storage, false);
    expect(mem.get(FOLLOW_THEME_PREF_KEY)).toBe("off");
    expect(followThemePrefOn(storage)).toBe(false);
    writeFollowThemePref(storage, true);
    expect(followThemePrefOn(storage)).toBe(true);
    expect(FOLLOW_THEME_PREF_KEY).toBe("gantree.followTheme");
  });
});

describe("voice pref", () => {
  it("defaults off (typing is the default) and only on swaps to hold-to-talk", () => {
    const { mem, storage } = memStorage();
    expect(voicePrefOn(null)).toBe(false);
    expect(voicePrefOn(storage)).toBe(false);
    writeVoicePref(storage, true);
    expect(mem.get(VOICE_PREF_KEY)).toBe("on");
    expect(voicePrefOn(storage)).toBe(true);
    writeVoicePref(storage, false);
    expect(voicePrefOn(storage)).toBe(false);
    mem.set(VOICE_PREF_KEY, "yes");
    expect(voicePrefOn(storage)).toBe(false);
    expect(VOICE_PREF_KEY).toBe("gantree.voice");
  });
});

describe("language pref", () => {
  it("defaults English, round-trips, and shrugs off junk", () => {
    const { mem, storage } = memStorage();
    expect(langPref(null)).toBe("en");
    expect(langPref(storage)).toBe("en");
    writeLangPref(storage, "ja");
    expect(mem.get(LANG_PREF_KEY)).toBe("ja");
    expect(langPref(storage)).toBe("ja");
    writeLangPref(storage, "zh");
    expect(langPref(storage)).toBe("zh");
    mem.set(LANG_PREF_KEY, "ja-JP");
    expect(langPref(storage)).toBe("en");
    expect(LANG_PREF_KEY).toBe("gantree.lang");
  });
});

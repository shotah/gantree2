import { parseLang, type LangId } from "./lang";
import { parsePhotoSize, type PhotoSizeId } from "./photo";

export const GEO_PREF_KEY = "gantree.geo";
export const PHOTO_PREF_KEY = "gantree.photo";
export const BACKDROP_PREF_KEY = "gantree.backdrop";
export const FOLLOW_THEME_PREF_KEY = "gantree.followTheme";
export const VOICE_PREF_KEY = "gantree.voice";
export const LANG_PREF_KEY = "gantree.lang";

type Getter = { getItem(key: string): string | null };
type Setter = { setItem(key: string, value: string): void };

/** Default on. Only `"off"` disables the this-send pin. */
export function geoPrefOn(storage: Getter | null | undefined): boolean {
  return storage?.getItem(GEO_PREF_KEY) !== "off";
}

export function writeGeoPref(storage: Setter, on: boolean): void {
  storage.setItem(GEO_PREF_KEY, on ? "on" : "off");
}

/** Settings → Photo size. Junk or missing → `DEFAULT_PHOTO_SIZE`. */
export function photoSizePref(storage: Getter | null | undefined): PhotoSizeId {
  return parsePhotoSize(storage?.getItem(PHOTO_PREF_KEY));
}

export function writePhotoSizePref(storage: Setter, id: PhotoSizeId): void {
  storage.setItem(PHOTO_PREF_KEY, id);
}

/** Settings → Backdrop. Default on; only `"off"` keeps the theme canvas behind the thread. */
export function backdropPrefOn(storage: Getter | null | undefined): boolean {
  return storage?.getItem(BACKDROP_PREF_KEY) !== "off";
}

export function writeBackdropPref(storage: Setter, on: boolean): void {
  storage.setItem(BACKDROP_PREF_KEY, on ? "on" : "off");
}

/** Settings → Follow the agent's mood. Default on; only `"off"` keeps the human's theme. */
export function followThemePrefOn(storage: Getter | null | undefined): boolean {
  return storage?.getItem(FOLLOW_THEME_PREF_KEY) !== "off";
}

export function writeFollowThemePref(storage: Setter, on: boolean): void {
  storage.setItem(FOLLOW_THEME_PREF_KEY, on ? "on" : "off");
}

/** Header mic → hold-to-talk compose. Default **off**: typing is the default; only `"on"` swaps. */
export function voicePrefOn(storage: Getter | null | undefined): boolean {
  return storage?.getItem(VOICE_PREF_KEY) === "on";
}

export function writeVoicePref(storage: Setter, on: boolean): void {
  storage.setItem(VOICE_PREF_KEY, on ? "on" : "off");
}

/** Settings → Language for hold-to-talk and Kit's voice. Junk or missing → English. */
export function langPref(storage: Getter | null | undefined): LangId {
  return parseLang(storage?.getItem(LANG_PREF_KEY));
}

export function writeLangPref(storage: Setter, id: LangId): void {
  storage.setItem(LANG_PREF_KEY, id);
}

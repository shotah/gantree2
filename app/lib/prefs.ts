/** Browser prefs. Only the theme ones for now; the chat PWA brings the rest in Phase 2. */

export const FOLLOW_THEME_PREF_KEY = "gantree.followTheme";

type Getter = { getItem(key: string): string | null };
type Setter = { setItem(key: string, value: string): void };

/** Follow the agent's mood. Default on; only `"off"` keeps the human's theme. */
export function followThemePrefOn(storage: Getter | null | undefined): boolean {
  return storage?.getItem(FOLLOW_THEME_PREF_KEY) !== "off";
}

export function writeFollowThemePref(storage: Setter, on: boolean): void {
  storage.setItem(FOLLOW_THEME_PREF_KEY, on ? "on" : "off");
}

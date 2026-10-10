import { knownTheme, themeCards, type ThemeCard, type ThemeId } from "./catalog";

export const THEME_STORE_KEY = "theme";

export type ThemeWrite = { theme: ThemeId };
export type ThemeRead = { theme: ThemeId | null; themes: ThemeCard[] };

export function parseThemeWrite(raw: unknown): { ok: true; theme: ThemeId } | { ok: false; detail: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, detail: "bad theme" };
  }
  const id = knownTheme((raw as Record<string, unknown>).theme);
  if (!id) {
    return { ok: false, detail: "bad theme" };
  }
  return { ok: true, theme: id };
}

export function encodeThemeState(theme: ThemeId | null): string {
  return JSON.stringify({ theme, themes: themeCards() } satisfies ThemeRead);
}

/**
 * Mailbox → every socket when the room theme changes. `theme` null means cleared.
 * No `text` on purpose: a mouth that predates this kind drops it.
 */
export function encodeThemeNotice(theme: ThemeId | null): string {
  return JSON.stringify({ kind: "theme", theme });
}

/**
 * Known id, empty string when cleared, null when this is not a theme notice
 * or the id is junk (still a notice — swallow it, do not paint a bubble).
 */
export function isThemeNotice(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).kind === "theme");
}

export function themeIdFromUnknown(raw: unknown): ThemeId | "" | null {
  if (!isThemeNotice(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.theme == null) {
    return "";
  }
  return knownTheme(o.theme);
}

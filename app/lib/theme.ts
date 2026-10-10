/** Color themes — Boom, Paper, Ink, and a mood dozen. Catalog is `lib/theme/catalog.ts`. */

import {
  DEFAULT_THEME,
  themeIdList,
  themeOf,
  THEMES,
  type ThemeId,
} from "@/lib/theme/catalog";
import { FOLLOW_THEME_PREF_KEY } from "@/app/lib/prefs";

export {
  DEFAULT_THEME,
  knownTheme,
  parseTheme,
  themeCards,
  themeOf,
  THEMES,
  type ThemeCard,
  type ThemeId,
} from "@/lib/theme/catalog";

export const THEME_KEY = "gantree.theme";
export const ROOM_THEME_KEY = "gantree.roomTheme";
export const THEME_EVENT = "gantree-theme";

export function themeFromQuery(v: string | null): ThemeId | null {
  return typeof v === "string" && themeIdList().includes(v) ? (v as ThemeId) : null;
}

export function themeCss(): string {
  return THEMES.map((t) => {
    const sel = t.id === DEFAULT_THEME ? `:root,[data-theme="${t.id}"]` : `[data-theme="${t.id}"]`;
    return `${sel}{${tokenCss(t.tokens)}}`;
  }).join("");
}

function stampThemeColor(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
  const canvas = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim()
    || themeOf(id).tokens.canvas;
  document.querySelector("meta[name=theme-color]")?.setAttribute("content", canvas);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Paint without claiming it as the human's pick. Room notices and follow-on use this. */
export function paintTheme(id: ThemeId): void {
  if (document.documentElement.getAttribute("data-theme") === id) {
    return;
  }
  stampThemeColor(id);
}

/** Human pick: persist and paint. Does not touch the follow flag. */
export function applyTheme(id: ThemeId): void {
  if (document.documentElement.getAttribute("data-theme") === id && localStorage.getItem(THEME_KEY) === id) {
    return;
  }
  localStorage.setItem(THEME_KEY, id);
  stampThemeColor(id);
}

export function cacheRoomTheme(id: ThemeId | null): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  if (id) {
    localStorage.setItem(ROOM_THEME_KEY, id);
    return;
  }
  localStorage.removeItem(ROOM_THEME_KEY);
}

export function cachedRoomTheme(): ThemeId | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return themeFromQuery(localStorage.getItem(ROOM_THEME_KEY));
}

export const THEME_BOOT
  = `(function(){try{var a=${JSON.stringify(themeIdList())};var follow=localStorage.getItem(${JSON.stringify(FOLLOW_THEME_PREF_KEY)})!=="off";var room=localStorage.getItem(${JSON.stringify(ROOM_THEME_KEY)});var mine=localStorage.getItem(${JSON.stringify(THEME_KEY)});var t=follow&&a.indexOf(room)!==-1?room:mine;if(a.indexOf(t)!==-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

function tokenCss(tokens: (typeof THEMES)[number]["tokens"]): string {
  const parts = [`color-scheme:${tokens.scheme}`];
  for (const [k, v] of Object.entries(tokens)) {
    if (k === "scheme") {
      continue;
    }
    const cssKey = k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    parts.push(`--${cssKey}:${v}`);
  }
  return parts.join(";");
}

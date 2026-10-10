"use client";

import { useEffect, useState } from "react";
import { applyTheme, DEFAULT_THEME, parseTheme, THEME_EVENT, THEME_KEY, THEMES, type ThemeId } from "@/app/lib/theme";

type ThemeRow = (typeof THEMES)[number];

function ThemeTile({
  theme,
  selected,
  onPick,
}: {
  theme: ThemeRow;
  selected: boolean;
  onPick: (id: ThemeId) => void;
}) {
  const { tokens } = theme;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={theme.label}
      title={theme.mood}
      onClick={() => onPick(theme.id)}
      className={`min-w-0 overflow-hidden rounded-xl text-left ${selected ? "ring-2 ring-accent" : "ring-1 ring-line"}`}
    >
      <span aria-hidden className="flex h-12 flex-col justify-between p-1.5" style={{ backgroundColor: tokens.canvas }}>
        <span className="h-2 w-2/3 rounded-sm" style={{ backgroundColor: tokens.panel }} />
        <span className="flex items-center gap-1">
          <span className="h-2 w-5 rounded-full" style={{ backgroundColor: tokens.accent }} />
          <span className="h-1.5 w-6 rounded-sm" style={{ backgroundColor: tokens.fg }} />
        </span>
      </span>
      <span
        className="block truncate px-1.5 py-1 text-[10px] font-medium"
        style={{ backgroundColor: tokens.panel, color: tokens.body }}
      >
        {theme.label}
      </span>
    </button>
  );
}

/** Fifteen theme tiles. Click paints the document; a sibling picker stays in sync via `THEME_EVENT`. */
export function ThemeGallery() {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    function sync() {
      setId(parseTheme(document.documentElement.getAttribute("data-theme")));
    }
    function onStorage(e: StorageEvent) {
      if (e.key && e.key !== THEME_KEY) {
        return;
      }
      const next = parseTheme(e.newValue ?? localStorage.getItem(THEME_KEY));
      applyTheme(next);
      setId(next);
    }
    sync();
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function pick(next: ThemeId) {
    setId(next);
    applyTheme(next);
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {THEMES.map((theme) => (
        <ThemeTile key={theme.id} theme={theme} selected={theme.id === id} onPick={pick} />
      ))}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { applyTheme, DEFAULT_THEME, parseTheme, THEME_EVENT, THEME_KEY, THEMES, themeOf, type ThemeId } from "@/app/lib/theme";

type ThemeRow = (typeof THEMES)[number];

const MOOD_FEELS = ["happy", "excited", "sad", "frustrated", "angry", "anxious"] as const;

function ThemeDot({ canvas, accent, line }: { canvas: string; accent: string; line: string }) {
  return (
    <span
      data-theme-swatch
      className="inline-flex h-3 w-3 shrink-0 overflow-hidden rounded-full border"
      style={{ borderColor: line }}
      aria-hidden
    >
      <span className="h-full w-1/2" style={{ backgroundColor: canvas }} />
      <span className="h-full w-1/2" style={{ backgroundColor: accent }} />
    </span>
  );
}

function ThemeOption({
  theme,
  selected,
  tag,
  onPick,
}: {
  theme: ThemeRow;
  selected: boolean;
  tag: string | null;
  onPick: (id: ThemeId) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={theme.label}
      title={theme.mood}
      className={`flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-body hover:bg-track ${selected ? "bg-track" : ""}`}
      onClick={() => onPick(theme.id)}
    >
      <ThemeDot canvas={theme.tokens.canvas} accent={theme.tokens.accent} line={theme.tokens.line} />
      <span className="min-w-0 truncate">{theme.label}</span>
      {tag
        ? <span aria-hidden className="ml-auto shrink-0 text-[10px] font-medium text-mark">{tag}</span>
        : null}
    </button>
  );
}

export function ThemeSelect({
  onHumanPick,
  roomTheme = null,
  followTheme = false,
  agentName = "Agent",
}: {
  onHumanPick?: () => void;
  /** Room id, so the row the agent picked can wear a tag while the human is following. */
  roomTheme?: ThemeId | null;
  followTheme?: boolean;
  /** Label on that tag. */
  agentName?: string;
}) {
  const [id, setId] = useState<ThemeId>(DEFAULT_THEME);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = themeOf(id);
  const plain = THEMES.filter((t) => t.feel === "neutral");

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

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointer(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: ThemeId) {
    onHumanPick?.();
    setId(next);
    applyTheme(next);
    setOpen(false);
    trigger.current?.focus();
  }

  function option(theme: ThemeRow) {
    return (
      <ThemeOption
        key={theme.id}
        theme={theme}
        selected={theme.id === id}
        tag={followTheme && roomTheme === theme.id ? agentName : null}
        onPick={pick}
      />
    );
  }

  return (
    <span ref={root} className="relative block">
      <button
        ref={trigger}
        type="button"
        aria-label="color theme"
        title={current.mood}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex w-full items-center gap-1.5 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-body"
        onClick={() => setOpen((v) => !v)}
      >
        <ThemeDot canvas={current.tokens.canvas} accent={current.tokens.accent} line={current.tokens.line} />
        <span className="min-w-0 truncate">{current.label}</span>
      </button>
      {open
        ? (
            <span
              id={listId}
              role="listbox"
              className="absolute inset-x-0 z-50 mt-1 max-h-72 overflow-y-auto rounded border border-line bg-panel py-1 shadow-lg"
            >
              <span role="group" aria-label="Plain" className="block">
                <span className="block px-2.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-dim">Plain</span>
                {plain.map((t) => option(t))}
              </span>
              <span role="group" aria-label="Moods" className="block">
                <span className="block px-2.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-dim">Moods</span>
                {MOOD_FEELS.map((feel) => (
                  <span key={feel} className="flex">
                    {THEMES.filter((t) => t.feel === feel).map((t) => option(t))}
                  </span>
                ))}
              </span>
            </span>
          )
        : null}
    </span>
  );
}

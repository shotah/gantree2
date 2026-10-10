"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { searchEmoji } from "@/app/lib/emoji";

function FaceIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="7" r="0.8" fill="currentColor" />
      <circle cx="10" cy="7" r="0.8" fill="currentColor" />
      <path
        d="M5.4 9.6c.7 1.1 1.5 1.6 2.6 1.6s1.9-.5 2.6-1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmojiButton({
  disabled,
  open,
  onToggle,
}: {
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="emoji"
      title="Emoji"
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      className={`flex h-7 w-7 min-h-0 shrink-0 items-center justify-center rounded-full p-0 ${
        open ? "text-mark" : "text-muted"
      } disabled:opacity-40`}
      onClick={onToggle}
    >
      <FaceIcon />
    </button>
  );
}

export function EmojiPanel({
  query,
  onQuery,
  onPick,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const choices = useMemo(() => searchEmoji(query), [query]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    searchRef.current?.focus();
    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (root.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[aria-label='emoji']")) {
        return;
      }
      onCloseRef.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      ref={root}
      id={menuId}
      role="dialog"
      aria-label="Emoji"
      className="absolute inset-x-3 bottom-full z-20 mb-1 rounded-xl border border-line bg-panel p-2 shadow-lg"
    >
      <input
        ref={searchRef}
        value={query}
        placeholder="Search or :shrug:"
        aria-label="Search emoji"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="mb-2 w-full rounded-lg border border-edge bg-canvas px-2 py-1.5 text-sm text-fg"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = choices[0];
            if (first) {
              onPick(first.emoji);
              onQuery("");
            }
          }
        }}
      />
      {choices.length
        ? (
            <div className="grid max-h-52 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-0.5 overflow-y-auto">
              {choices.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  aria-label={`:${entry.name}:`}
                  title={`:${entry.name}:`}
                  className="flex h-9 items-center justify-center rounded-lg text-xl hover:bg-track"
                  onClick={() => {
                    onPick(entry.emoji);
                    onQuery("");
                  }}
                >
                  {entry.emoji}
                </button>
              ))}
            </div>
          )
        : <p className="px-1 py-2 text-xs text-dim">No matches</p>}
    </div>
  );
}

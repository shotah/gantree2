"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { parseSlug } from "@/lib/chat/slug";
import { manageRows, readSession, type ManageLink } from "@/lib/door/landing";

function slugFromChatPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "chat") {
    return null;
  }
  try {
    return parseSlug(decodeURIComponent(parts[1] ?? ""));
  } catch {
    return null;
  }
}

function CogIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
      />
    </svg>
  );
}

/**
 * Cog in the header; the panel is a drawer that slides in from the right and
 * scrolls on its own, so a long Settings never hangs off the bottom of a
 * phone. Scrim, Escape, outside tap, or the × close it.
 *
 * The first open fetches `/api/auth/me` once and adds Manage / All agents
 * for an admin, or Manage for an operator who runs this chat's agent.
 */
export function SettingsMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ManageLink[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const mounted = useRef(true);
  const menuId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || asked.current) {
      return;
    }
    asked.current = true;
    const slug = slugFromChatPath(window.location.pathname);
    void (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const who = res.ok ? readSession(await res.json()) : null;
        if (mounted.current) {
          setRows(manageRows(who, slug));
        }
      } catch {
        if (mounted.current) {
          setRows([]);
        }
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
    function onPointer(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative ml-auto shrink-0">
      <button
        type="button"
        aria-label="settings"
        title="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-track hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        <CogIcon />
      </button>
      {open
        ? (
            <>
              <div
                data-testid="settings-scrim"
                aria-hidden
                className="fixed inset-0 z-30 bg-black/40"
                onClick={() => setOpen(false)}
              />
              <div
                id={menuId}
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-label="Settings"
                tabIndex={-1}
                className="fixed inset-y-0 right-0 z-30 flex w-72 max-w-[85vw] flex-col border-l border-line bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none animate-drawer motion-reduce:animate-none"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
                  <p className="text-sm font-medium text-fg">Settings</p>
                  <button
                    type="button"
                    aria-label="Close settings"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-track hover:text-fg"
                    onClick={() => setOpen(false)}
                  >
                    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
                      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                  {rows.length > 0
                    ? (
                        <nav aria-label="Console" className="mb-3 flex flex-col gap-1.5 border-b border-line pb-3">
                          <span className="text-xs text-muted">Console</span>
                          {rows.map((row) => (
                            <a
                              key={row.href}
                              href={row.href}
                              className="flex items-center justify-between rounded-xl border border-line bg-canvas/60 px-3 py-2 text-sm text-fg hover:border-accent-line hover:text-mark"
                            >
                              {row.label}
                              <span aria-hidden className="text-dim">→</span>
                            </a>
                          ))}
                        </nav>
                      )
                    : null}
                  {children}
                </div>
              </div>
            </>
          )
        : null}
    </div>
  );
}

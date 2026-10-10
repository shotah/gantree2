import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { readFolds, writeFold } from "@/app/lib/folds";

export const mainClass = "mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-10";
export const boardMainClass = "mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10";
export const inputClass = "rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-body focus:border-accent-line focus:outline-none";
export const labelClass = "text-xs text-muted";
export const primaryClass = "inline-flex items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-canvas shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50";
export const quietClass = "inline-flex items-center justify-center rounded-xl border border-line bg-canvas/60 px-3 py-1.5 text-sm text-body transition-colors hover:border-accent-line hover:text-fg disabled:opacity-50";
export const dangerClass = "inline-flex items-center justify-center rounded-xl border border-danger-line bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger disabled:opacity-50";
export const alertClass = "rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger";

/** A page-wide "all folds open / all folds shut" pulse. `rev` ticks so the same value can be sent twice. */
type FoldSignal = { open: boolean; rev: number };

const FoldSignalContext = createContext<FoldSignal>({ open: true, rev: 0 });
const FoldSetContext = createContext<((open: boolean) => void) | null>(null);
/** The group's storage id, so each fold can remember its own state by title. */
const FoldMemoryContext = createContext<string | null>(null);

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Wrap a page's folds so one button can shut or open them all, and so each
 * fold remembers whether it was left open in this browser (`id` names the
 * page). Each fold keeps its own `open` state wherever it lives; the group
 * only pulses a value through context and every mounted fold calls its
 * `onOpen` with it.
 */
export function FoldGroup({ id, children }: { id?: string; children: ReactNode }) {
  const [signal, setSignal] = useState<FoldSignal>({ open: true, rev: 0 });
  const setAll = useCallback((open: boolean) => {
    setSignal((prev) => ({ open, rev: prev.rev + 1 }));
  }, []);
  return (
    <FoldMemoryContext.Provider value={id ?? null}>
      <FoldSetContext.Provider value={setAll}>
        <FoldSignalContext.Provider value={signal}>{children}</FoldSignalContext.Provider>
      </FoldSetContext.Provider>
    </FoldMemoryContext.Provider>
  );
}

/** One button: "Collapse all" until used, then "Open all". Renders nothing outside a `FoldGroup`. */
export function FoldAllButton() {
  const setAll = useContext(FoldSetContext);
  const signal = useContext(FoldSignalContext);
  if (!setAll) {
    return null;
  }
  const collapsed = signal.rev > 0 && !signal.open;
  const label = collapsed ? "Open all" : "Collapse all";
  return (
    <button type="button" aria-label={label} aria-pressed={collapsed} onClick={() => setAll(collapsed)} className={`${quietClass} gap-1.5`}>
      {label}
      <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="currentColor" aria-hidden>
        <path d="M5.2 7.5a1 1 0 0 1 1.4 0L10 10.9l3.4-3.4a1 1 0 1 1 1.4 1.4l-4.1 4.1a1 1 0 0 1-1.4 0L5.2 8.9a1 1 0 0 1 0-1.4Z" />
      </svg>
    </button>
  );
}

export function Fold({
  title,
  hint,
  open,
  onOpen,
  children,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const signal = useContext(FoldSignalContext);
  const memory = useContext(FoldMemoryContext);
  const onOpenRef = useRef(onOpen);
  const seenRev = useRef(signal.rev);
  const restored = useRef(false);
  /** A remembered value we asked the owner to apply; nothing is written until it lands. */
  const restoreTo = useRef<boolean | null>(null);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    if (signal.rev !== seenRev.current) {
      seenRev.current = signal.rev;
      onOpenRef.current(signal.open);
    }
  }, [signal]);
  // Restore before paint so a remembered-shut fold never flashes open on refresh.
  useLayoutEffect(() => {
    if (memory === null || restored.current) {
      return;
    }
    restored.current = true;
    const kept = readFolds(storage(), memory)[title];
    if (kept !== undefined && kept !== open) {
      restoreTo.current = kept;
      onOpenRef.current(kept);
    }
  }, [memory, title, open]);
  useEffect(() => {
    if (memory === null || !restored.current) {
      return;
    }
    if (restoreTo.current !== null) {
      if (open !== restoreTo.current) {
        return;
      }
      restoreTo.current = null;
    }
    writeFold(storage(), memory, title, open);
  }, [memory, title, open]);

  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-line bg-panel/90 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={() => onOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium text-fg hover:bg-track/60"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {hint ? <span className="text-xs font-normal text-dim">{hint}</span> : null}
          <span
            aria-hidden
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center text-dim transition-transform ${open ? "rotate-180" : ""}`}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
              <path d="M5.2 7.5a1 1 0 0 1 1.4 0L10 10.9l3.4-3.4a1 1 0 1 1 1.4 1.4l-4.1 4.1a1 1 0 0 1-1.4 0L5.2 8.9a1 1 0 0 1 0-1.4Z" />
            </svg>
          </span>
        </span>
      </button>
      {open ? <div className="border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

import type { ReactNode } from "react";

export const mainClass = "mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10";
export const boardMainClass = "mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10";
export const inputClass = "rounded border border-line bg-canvas px-3 py-1.5 text-sm text-body";
export const labelClass = "text-xs text-muted";
export const primaryClass = "rounded bg-accent px-4 py-2 text-sm font-medium text-canvas hover:bg-accent-hover disabled:opacity-50";
export const quietClass = "rounded border border-line px-3 py-1.5 text-sm text-body hover:bg-track disabled:opacity-50";
export const dangerClass = "rounded border border-danger-line bg-danger-soft px-3 py-1.5 text-sm text-danger disabled:opacity-50";
export const alertClass = "rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger";

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
  return (
    <section aria-label={title} className="rounded border border-line">
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={() => onOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-fg"
      >
        <span>{title}</span>
        {hint ? <span className="text-xs font-normal text-dim">{hint}</span> : null}
      </button>
      {open ? <div className="border-t border-line px-4 py-3">{children}</div> : null}
    </section>
  );
}

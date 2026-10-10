import type { ReactNode } from "react";
import { ThemeSelect } from "./ThemeSelect";
import { TreeMark } from "./TreeMark";

export type NavLink = { href: string; label: string };

/** Hero band every settings screen opens with: brand row, title, blurb, nav, theme picker. */
/** Not `overflow-hidden`: the theme list must be able to hang below the band. The glow blobs clip themselves. */
export const heroClass = "relative rounded-2xl border border-line bg-gradient-to-br from-accent-soft via-panel to-panel px-5 py-5 shadow-[0_1px_0_0_var(--line)_inset] sm:px-6";

/** A rounded card that sits on the canvas glow. */
export const cardClass = "rounded-2xl border border-line bg-panel/90 px-4 py-4 shadow-sm backdrop-blur-sm sm:px-5";

/** Small coloured label. Pair with a `text-*`/`bg-*` tone. */
export const chipClass = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium";

export function Brand({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <a href={href} className={`inline-flex items-center gap-2 text-fg ${className}`} aria-label="gantree home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-canvas/70 text-fg ring-1 ring-line">
        <TreeMark className="h-7 w-7" />
      </span>
      <span className="text-sm font-semibold tracking-tight">gantree</span>
    </a>
  );
}

export function PageHeader({
  title,
  blurb,
  crumb,
  nav = [],
  theme = true,
  children,
  aside,
}: {
  title: ReactNode;
  blurb?: ReactNode;
  /** A parent link to show beside the brand (`{ href: "/agents", label: "Agents" }`). */
  crumb?: NavLink;
  nav?: readonly NavLink[];
  /** Show the colour theme picker on the right. */
  theme?: boolean;
  /** Anything under the title row — tags, pills. */
  children?: ReactNode;
  /** Right-hand slot under the theme picker — a primary action. */
  aside?: ReactNode;
}) {
  return (
    <header className={heroClass}>
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <span className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-accent/15 blur-3xl" />
        <span className="absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-info/10 blur-3xl" />
      </span>
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Brand />
            {crumb
              ? (
                  <>
                    <span aria-hidden className="text-faint">/</span>
                    <a href={crumb.href} className="hover:text-body">{crumb.label}</a>
                  </>
                )
              : null}
          </div>
          <h1 className="truncate text-3xl font-semibold tracking-tight text-fg">{title}</h1>
          {blurb ? <p className="text-sm text-muted">{blurb}</p> : null}
          {nav.length > 0
            ? (
                <nav aria-label="Board" className="flex flex-wrap gap-2 pt-1">
                  {nav.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className="rounded-full border border-line bg-canvas/60 px-3 py-1 text-xs font-medium text-body hover:border-accent-line hover:text-fg"
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              )
            : null}
          {children}
        </div>
        {theme || aside
          ? (
              <div className="flex shrink-0 flex-col items-end gap-2">
                {theme ? <div className="w-40"><ThemeSelect align="end" /></div> : null}
                {aside}
              </div>
            )
          : null}
      </div>
    </header>
  );
}

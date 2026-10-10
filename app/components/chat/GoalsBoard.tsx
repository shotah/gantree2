"use client";

import { useEffect, useId, useRef } from "react";
import { dayLabel, linkLine, signed, statsLine, type AimDay, type AimLink, type AimRow, type AimWeek } from "@/lib/chat/aims";

/**
 * The goals board: the crane's aims ledger as the mailbox last pushed it
 * (docs/frontends.md → Aims board). Read-only paint; the one way back into
 * the harness is the `/aims` slash command the crane already answers, so
 * every button here is a visible turn in the thread.
 */

function TargetIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="1.25" fill="currentColor" />
    </svg>
  );
}

/**
 * Header button. Nothing when the board is empty — the screen is optional.
 * The badge is a call to action: how many aims changed since the human
 * last opened the drawer (`lib/phone/boardSeen.ts`), never the board size.
 */
export function GoalsButton({ count, changes, open, onToggle }: {
  count: number;
  changes: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (!count) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label={changes ? `goals (${changes} changed)` : "goals"}
      title="Goals"
      aria-haspopup="dialog"
      aria-expanded={open}
      className={`relative flex h-8 w-8 items-center justify-center rounded-lg hover:bg-track hover:text-fg ${
        open ? "text-mark" : "text-muted"
      }`}
      onClick={onToggle}
    >
      <TargetIcon />
      {changes > 0
        ? (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ok px-1 text-center text-[10px] font-medium leading-4 text-canvas">
              {changes}
            </span>
          )
        : null}
    </button>
  );
}

/** Score → cell paint. Sign is the hue, magnitude the weight; an eventless day is an outline. */
export function dayCellClass(d: AimDay): string {
  if (!d.events.length && d.score === 0) {
    return "border border-line bg-transparent";
  }
  if (d.score > 0) {
    return d.score >= 3 ? "bg-ok" : d.score === 2 ? "bg-ok opacity-75" : "bg-ok opacity-45";
  }
  if (d.score < 0) {
    return d.score <= -3 ? "bg-danger" : d.score === -2 ? "bg-danger opacity-75" : "bg-danger opacity-45";
  }
  return "bg-track";
}

function DayGrid({ days }: { days: AimDay[] }) {
  if (!days.length) {
    return <p className="text-xs text-dim">No days scored yet.</p>;
  }
  return (
    <ol className="flex gap-1" aria-label="day scores">
      {days.map((d) => (
        <li key={d.day} className="flex flex-col items-center gap-0.5" aria-label={dayLabel(d)} title={dayLabel(d)}>
          <span className={`block h-5 w-6 rounded ${dayCellClass(d)}`} />
          <span className="text-[10px] leading-none text-dim">
            {d.events.length ? signed(d.score) : "·"}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** `Mon Sep 21 +0.5` — one week bucket, said out loud. */
export function weekLabel(w: AimWeek): string {
  const when = new Date(`${w.start}T00:00:00`);
  const start = Number.isNaN(when.getTime())
    ? w.start
    : when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `week of ${start} ${signed(w.mean, 1)}`;
}

/**
 * Week means as bars around a zero line: up is ok, down is danger, height
 * is `|mean| / 3`. Oldest left. Thirteen at most, so it stays a strip.
 */
function WeekStrip({ weeks }: { weeks: AimWeek[] }) {
  return (
    <ol className="flex h-8 items-stretch gap-0.5" aria-label="week means">
      {weeks.map((w) => {
        const pct = Math.round((Math.min(3, Math.abs(w.mean)) / 3) * 50);
        const up = w.mean > 0;
        return (
          <li
            key={w.start}
            className="relative w-2.5 flex-none"
            aria-label={weekLabel(w)}
            title={weekLabel(w)}
          >
            <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
            {pct
              ? (
                  <span
                    className={`absolute inset-x-0 rounded-sm ${up ? "bottom-1/2 bg-ok" : "top-1/2 bg-danger"}`}
                    style={{ height: `${pct}%` }}
                  />
                )
              : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Phase 1 lines. Each is present only when the crane stamped it; a missing one means too early. */
function TrendLine({ row }: { row: AimRow }) {
  const parts: string[] = [];
  if (row.slope !== undefined) {
    parts.push(`slope ${signed(row.slope, 1)}/wk`);
  }
  if (row.block) {
    parts.push(`block ${row.block.up}/${row.block.days} (${Math.round(row.block.pct * 100)}%)`);
  }
  if (row.effect) {
    const what = row.effect.metric || row.effect.b || "effect";
    parts.push(`${what} r ${signed(row.effect.r, 2)} (n ${row.effect.n})`);
  }
  if (!parts.length) {
    return null;
  }
  return <p className="text-xs text-dim">{parts.join(" · ")}</p>;
}

function AimCard({ row, onAsk }: { row: AimRow; onAsk: (command: string) => void }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-line bg-kit p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-fg">{row.area}</h3>
        <span className={`shrink-0 text-sm font-medium ${row.rating30 > 0 ? "text-ok" : row.rating30 < 0 ? "text-danger" : "text-dim"}`}>
          {signed(row.rating30, 1)}
        </span>
      </div>
      <p className="text-sm text-body">{row.sentence}</p>
      <DayGrid days={row.days} />
      <p className="text-xs text-muted">{statsLine(row)}</p>
      {row.weeks?.length
        ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-dim">weeks</span>
              <WeekStrip weeks={row.weeks} />
            </div>
          )
        : null}
      <TrendLine row={row} />
      <button
        type="button"
        className="self-start rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track"
        onClick={() => onAsk(`/aims ${row.area}`)}
      >
        Ask Kit about {row.area}
      </button>
    </li>
  );
}

export function GoalsSheet({
  aims,
  links = [],
  onClose,
  onAsk,
}: {
  aims: AimRow[];
  /** Cross-aim next-day lines, strongest first; the crane only sends ones worth reading. */
  links?: AimLink[];
  onClose: () => void;
  /** A `/aims …` line to send as a turn; the sheet closes so the answer is in view. */
  onAsk: (command: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    panel.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const ask = (command: string) => {
    onAsk(command);
    onClose();
  };

  return (
    <>
      <div data-testid="goals-scrim" aria-hidden className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div
        id={id}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Goals"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-30 flex w-80 max-w-[92vw] flex-col border-l border-line bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none animate-drawer motion-reduce:animate-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <p className="text-sm font-medium text-fg">Goals</p>
          <button
            type="button"
            aria-label="Close goals"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-track hover:text-fg"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {aims.length
            ? (
                <ol className="flex flex-col gap-2">
                  {aims.map((row) => <AimCard key={row.area} row={row} onAsk={ask} />)}
                </ol>
              )
            : <p className="text-sm text-dim">No aims on the board.</p>}
          {links.length
            ? (
                <ul className="mt-2 flex flex-col gap-0.5" aria-label="between aims">
                  {links.map((l) => (
                    <li key={`${l.a}>${l.b}`} className="text-xs text-muted">{linkLine(l)}</li>
                  ))}
                </ul>
              )
            : null}
          <p className="mt-3 text-[11px] leading-snug text-dim">
            Scores are Kit&apos;s read on each day, −3 to +3, against the aim. Argue with one in the thread.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track"
              onClick={() => ask("/aims")}
            >
              Full report
            </button>
            <button
              type="button"
              className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track"
              onClick={() => ask("/aims rubric")}
            >
              Rubric
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

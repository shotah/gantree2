"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { REACTION_PALETTE, toggleReaction } from "@/lib/chat/react";
import { MarkdownBody } from "./MarkdownBody";

export type ChatBubble = {
  id: string;
  from: "you" | "kit";
  text: string;
  kind?: string;
  at: number;
  seq?: number;
  photo?: string;
  pending?: boolean;
  /** Same React key as the draft so promoting to reply does not remount. */
  live?: boolean;
  /** Mailbox refused it; sentence from `describeSendError`. */
  failed?: string;
  /** Emoji set on this bubble — Kit's on yours, yours on Kit's (docs/frontends.md → Reactions). */
  reaction?: string;
};

/** Flushed inbound is your mouth; everything else follows the viewer role. */
export function bubbleFrom(viewerIsPhone: boolean, kind?: string): ChatBubble["from"] {
  if (viewerIsPhone && kind === "inbound") {
    return "you";
  }
  return viewerIsPhone ? "kit" : "you";
}

/** Hold this long on a Kit bubble and the palette opens. */
export const REACT_HOLD_MS = 450;

/** Kit's finished turns take a reaction; a draft, a refusal, or your own bubble does not. */
export function canReact(m: Pick<ChatBubble, "from" | "kind" | "id">): boolean {
  return m.from === "kit" && (m.kind === "reply" || m.kind === "push") && Boolean(m.id);
}

/** Rides the bubble's bottom corner, half over the edge — outer side, like every chat app. */
function ReactionChip({ emoji, side, onClick }: { emoji: string; side: "left" | "right"; onClick?: () => void }) {
  const cls = `absolute -bottom-2.5 ${side === "right" ? "right-2" : "left-2"} inline-flex items-center `
    + "rounded-full border border-line bg-panel px-1.5 py-0.5 text-[0.85em] leading-none shadow-sm";
  if (!onClick) {
    return <span aria-label={`reaction ${emoji}`} className={cls}>{emoji}</span>;
  }
  return (
    <button type="button" aria-label={`reaction ${emoji}`} className={`${cls} min-h-0`} onClick={onClick}>
      {emoji}
    </button>
  );
}

function ReactionPicker({ current, onPick }: { current?: string; onPick: (emoji: string) => void }) {
  return (
    <div
      role="group"
      aria-label="React"
      className="mt-1 flex max-w-[85%] flex-wrap gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-lg"
    >
      {REACTION_PALETTE.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          aria-pressed={current === emoji}
          className={`flex h-8 w-8 min-h-0 items-center justify-center rounded-lg p-0 text-lg ${
            current === emoji ? "bg-track" : "hover:bg-track"
          }`}
          onClick={() => onPick(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function Thread({
  messages,
  empty,
  onReact,
}: {
  messages: ChatBubble[];
  empty?: ReactNode;
  /** Long-press / right-click a Kit bubble → palette → this. Empty emoji clears. Absent: no picker. */
  onReact?: (id: string, emoji: string) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const hold = useRef<{ id: string; timer: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!picking) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPicking(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picking]);

  function cancelHold() {
    if (hold.current) {
      window.clearTimeout(hold.current.timer);
      hold.current = null;
    }
  }

  function startHold(e: ReactPointerEvent, id: string) {
    cancelHold();
    hold.current = {
      id,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        hold.current = null;
        setPicking(id);
      }, REACT_HOLD_MS),
    };
  }

  function moveHold(e: ReactPointerEvent) {
    const h = hold.current;
    if (h && (Math.abs(e.clientX - h.x) > 10 || Math.abs(e.clientY - h.y) > 10)) {
      cancelHold();
    }
  }

  if (!messages.length) {
    return empty ?? (
      <p className="px-4 py-8 text-center text-chat text-dim">
        Nothing yet. Type below — the other side of this room hears it.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2 px-3 py-4">
      {messages.map((m) => {
        const mine = m.from === "you";
        const reactable = Boolean(onReact) && canReact(m);
        const open = reactable && picking === m.id;
        const pick = (emoji: string) => {
          onReact?.(m.id, toggleReaction(m.reaction, emoji));
          setPicking(null);
        };
        const chip = Boolean(m.reaction) && !open;
        return (
          <li key={m.live ? "kit-live" : m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
            {/* The chip overlaps the bubble's bottom edge; the wrapper pads for it so the next row does not collide. */}
            <div className={`relative max-w-[85%]${chip ? " mb-2.5" : ""}`}>
              <div
                className={`rounded-2xl border px-3 py-2 text-chat leading-relaxed ${
                  mine
                    ? "border-accent-line bg-you text-fg"
                    : "border-line bg-kit text-body shadow-sm"
                }${reactable ? " pointer-coarse:select-none" : ""}`}
                onPointerDown={reactable ? (e) => startHold(e, m.id) : undefined}
                onPointerMove={reactable ? moveHold : undefined}
                onPointerUp={reactable ? cancelHold : undefined}
                onPointerCancel={reactable ? cancelHold : undefined}
                onPointerLeave={reactable ? cancelHold : undefined}
                onContextMenu={reactable
                  ? (e) => {
                      e.preventDefault();
                      cancelHold();
                      setPicking(m.id);
                    }
                  : undefined}
              >
                {m.kind === "push"
                  ? <p className="mb-1 text-[0.7em] uppercase tracking-wide text-dim">ping</p>
                  : null}
                {m.photo
                  ? <img src={m.photo} alt="" className="mb-2 max-h-48 rounded-lg" />
                  : null}
                {m.text
                  ? (
                      <div className={m.kind === "draft" ? "italic text-dim" : undefined}>
                        <MarkdownBody text={m.text} />
                      </div>
                    )
                  : null}
                {mine && m.failed
                  ? <p role="alert" className="mt-1 text-[0.7em] text-danger">{m.failed}</p>
                  : mine && m.pending
                    ? <p className="mt-1 text-[0.7em] text-dim">sending</p>
                    : null}
              </div>
              {chip && m.reaction
                ? (
                    <ReactionChip
                      emoji={m.reaction}
                      side={mine ? "right" : "left"}
                      onClick={reactable ? () => setPicking(m.id) : undefined}
                    />
                  )
                : null}
            </div>
            {open ? <ReactionPicker current={m.reaction} onPick={pick} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

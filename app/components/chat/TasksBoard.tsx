"use client";

import { type SubmitEvent, useEffect, useId, useRef, useState } from "react";
import { ageLabel, priorityMark, sortTodo, type TodoItem, todoPriority, todoWords } from "@/lib/chat/todo";

/**
 * The tasks board: the human's pocket list as the mailbox last pushed it
 * (docs/frontends.md → Tasks board; crane `docs/tasks.md`). A checklist.
 * The one kernel write is the checkbox — `/todo done <id>` — and it is a
 * visible turn like everything else here. Adding is plain words to Kit,
 * who names the row; there is no `/todo add`. Rows sort urgent, high,
 * then the rest (`sortTodo`), oldest first inside a tier — the same
 * order as the `[todo]` stamp — with the `!!` / `!` mark painted ahead
 * of the words instead of inside them.
 */

/** Past this many open, the `/todo` footer says "a pocket list"; so does the drawer. */
export const TODO_LONG = 10;

function CheckSquareIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M6.5 10.2l2.4 2.4 4.6-5" />
    </svg>
  );
}

/**
 * Header button. Nothing when the list is empty. The badge is a call to
 * action: tasks that changed since the drawer was last opened
 * (`lib/phone/boardSeen.ts`), never the list size.
 */
export function TasksButton({ count, changes, open, onToggle }: {
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
      aria-label={changes ? `tasks (${changes} changed)` : "tasks"}
      title="Tasks"
      aria-haspopup="dialog"
      aria-expanded={open}
      className={`relative flex h-8 w-8 items-center justify-center rounded-lg hover:bg-track hover:text-fg ${
        open ? "text-mark" : "text-muted"
      }`}
      onClick={onToggle}
    >
      <CheckSquareIcon />
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

/** `#412 · dentist · 3d ago` — the id is what `/todo done` takes, the age is how long it has nagged. */
export function metaLine(t: TodoItem, now?: Date): string {
  const parts = [`#${t.id}`, t.slug];
  const age = ageLabel(t.at, now);
  if (age) {
    parts.push(age);
  }
  return parts.join(" · ");
}

function TaskRow({ task, pending, onDone }: { task: TodoItem; pending: boolean; onDone: (id: number) => void }) {
  const words = todoWords(task);
  const priority = todoPriority(task);
  const mark = priorityMark(priority);
  return (
    <li className="flex items-center gap-1">
      {/* The button is the thumb-sized hit area (globals.css gives phone buttons 44 px); the span is the box. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={pending}
        aria-label={`done: ${words}`}
        disabled={pending}
        className="-my-1.5 -ml-1.5 flex h-11 w-9 shrink-0 items-center justify-center"
        onClick={() => onDone(task.id)}
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded border ${
            pending ? "border-ok bg-ok text-canvas" : "border-edge bg-transparent text-transparent hover:border-fg"
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden>
            <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M5 10.5l3.2 3.2L15 7" />
          </svg>
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {mark
            ? (
                <span
                  title={priority}
                  className={`shrink-0 text-xs font-semibold ${priority === "urgent" ? "text-danger" : "text-mark"}`}
                >
                  {mark}
                </span>
              )
            : null}
          <p className={`min-w-0 text-sm leading-snug ${pending ? "text-dim line-through" : "text-fg"}`}>{words}</p>
        </div>
        <p className="mt-0.5 text-[11px] text-muted">{metaLine(task)}</p>
      </div>
    </li>
  );
}

export function TasksSheet({
  todo,
  pending = [],
  onClose,
  onDone,
  onSend,
}: {
  todo: TodoItem[];
  /** Ids whose `/todo done` has gone out; ticked until the next board settles them. */
  pending?: number[];
  onClose: () => void;
  /** The checkbox: send `/todo done <id>`. The drawer stays open — the next board removes the row. */
  onDone: (id: number) => void;
  /** Plain words to Kit (`/todo` for the text view, or a new task in the human's words); the sheet closes so the answer is in view. */
  onSend: (text: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [draft, setDraft] = useState("");
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

  const send = (text: string) => {
    onSend(text);
    onClose();
  };

  const add = (e: SubmitEvent) => {
    e.preventDefault();
    const words = draft.replace(/\s+/gu, " ").trim();
    if (!words) {
      return;
    }
    send(`add to my list: ${words}`);
  };

  return (
    <>
      <div data-testid="tasks-scrim" aria-hidden className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <div
        id={id}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Tasks"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-30 flex w-80 max-w-[92vw] flex-col border-l border-line bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none animate-drawer motion-reduce:animate-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
          <p className="text-sm font-medium text-fg">Tasks</p>
          <button
            type="button"
            aria-label="Close tasks"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-track hover:text-fg"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
              <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {todo.length
            ? (
                <ul className="flex flex-col gap-2.5" aria-label="open tasks">
                  {sortTodo(todo).map((t) => <TaskRow key={t.slug} task={t} pending={pending.includes(t.id)} onDone={onDone} />)}
                </ul>
              )
            : <p className="text-sm text-dim">Nothing on the list.</p>}
          {todo.length > TODO_LONG
            ? <p className="mt-2 text-[11px] text-muted">{todo.length} open — a pocket list; prune, or use a tracker.</p>
            : null}
          <form className="mt-3 flex gap-2" onSubmit={add}>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a task, in your words"
              aria-label="New task"
              maxLength={240}
              autoComplete="off"
              enterKeyHint="send"
              className="min-w-0 flex-1 rounded-lg border border-edge bg-transparent px-2 py-1 text-sm text-fg placeholder:text-dim"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track disabled:opacity-40"
            >
              Add
            </button>
          </form>
          <p className="mt-3 text-[11px] leading-snug text-dim">
            Ticking one tells Kit it&apos;s done. Kit keeps the list; only you close a task.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-edge px-2 py-1 text-xs text-fg hover:bg-track"
              onClick={() => send("/todo")}
            >
              Full list
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

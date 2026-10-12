"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmojiButton, EmojiPanel } from "./EmojiPicker";
import { HoldToTalk } from "./HoldToTalk";
import { applyEmoji } from "@/app/lib/emoji";
import { fileFromClipboard } from "@/app/lib/photo";
import { matchSlash, slashInsert, slashToken, type SlashCommand } from "@/app/lib/slash";
import type { SpeakPhase } from "@/lib/phone/speaker";
import type { RecognizerCtor } from "@/lib/phone/speech";

function ClipIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.2 8.4l4.8-4.8a2.2 2.2 0 013.1 3.1L7.3 12.5a3.3 3.3 0 11-4.7-4.7l6.3-6.3"
      />
    </svg>
  );
}

function AttachChip({
  gpsOn,
  gpsHint,
  disabled,
  onCamera,
  onPhoto,
  onCommands,
  onToggle,
  onPin,
}: {
  gpsOn: boolean;
  gpsHint?: string;
  disabled?: boolean;
  onCamera?: () => void;
  onPhoto?: () => void;
  onCommands?: () => void;
  onToggle?: () => void;
  onPin?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menuId = useId();

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
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(fn?: () => void) {
    setOpen(false);
    fn?.();
  }

  return (
    <span ref={root} className="relative">
      <button
        type="button"
        aria-label="attach"
        title={gpsHint ?? "Attach"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="relative flex h-7 w-7 min-h-0 shrink-0 items-center justify-center overflow-visible rounded-full p-0 text-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <ClipIcon />
        {gpsOn
          ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
          : null}
      </button>
      {open
        ? (
            <div
              id={menuId}
              role="dialog"
              aria-label="Attach"
              className="absolute bottom-full left-0 z-20 mb-1 w-52 rounded-xl border border-line bg-panel p-1.5 shadow-lg"
            >
              {onCamera
                ? (
                    <button
                      type="button"
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-body hover:bg-track disabled:opacity-40"
                      disabled={disabled}
                      onClick={() => pick(onCamera)}
                    >
                      Camera
                    </button>
                  )
                : null}
              {onPhoto
                ? (
                    <button
                      type="button"
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-body hover:bg-track disabled:opacity-40"
                      disabled={disabled}
                      onClick={() => pick(onPhoto)}
                    >
                      Photo
                    </button>
                  )
                : null}
              {onCommands
                ? (
                    <button
                      type="button"
                      aria-label="commands"
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-body hover:bg-track disabled:opacity-40"
                      disabled={disabled}
                      onClick={() => pick(onCommands)}
                    >
                      Commands
                    </button>
                  )
                : null}
              {gpsHint
                ? <p className="px-2 py-1 text-[11px] text-dim">{gpsHint}</p>
                : null}
              {onToggle
                ? (
                    <button
                      type="button"
                      aria-pressed={gpsOn}
                      aria-label={gpsOn ? "GPS on" : "GPS off"}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-body hover:bg-track"
                      onClick={onToggle}
                    >
                      <span>GPS</span>
                      <span className={gpsOn ? "text-ok" : "text-muted"}>{gpsOn ? "on" : "off"}</span>
                    </button>
                  )
                : null}
              {onPin
                ? (
                    <button
                      type="button"
                      aria-label="drop pin"
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-body hover:bg-track disabled:opacity-40"
                      disabled={disabled || !gpsOn}
                      onClick={onPin}
                    >
                      Drop a silent pin
                    </button>
                  )
                : null}
            </div>
          )
        : null}
    </span>
  );
}

function takePhotoPaste(
  e: ClipboardEvent,
  onPhoto: ((file: File) => void) | undefined,
  box: HTMLTextAreaElement | null,
): void {
  if (e.defaultPrevented || !onPhoto) {
    return;
  }
  const file = fileFromClipboard(e.clipboardData);
  if (!file) {
    return;
  }
  const t = e.target;
  if (t !== box && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) {
    return;
  }
  if (t instanceof HTMLElement && t !== box && t.isContentEditable) {
    return;
  }
  e.preventDefault();
  onPhoto(file);
}

export function Compose({
  disabled,
  placeholder,
  onSend,
  onPhoto,
  photo,
  onPhotoClear,
  onPin,
  gpsHint,
  gpsOn = true,
  onGpsToggle,
  onEngage,
  commands,
  catalog = [],
  initialText = "",
  initialEmoji = false,
  voice = false,
  recognizer = null,
  lang,
  onVoice,
  speaking = "idle",
}: {
  disabled?: boolean;
  placeholder?: string;
  /** Text only; the staged `photo` rides along on the same turn from the owner. */
  onSend: (text: string) => void;
  /**
   * Header mic is on: the whole input row becomes one hold-to-talk bar. Typing is
   * the default; the owner flips this from `VoiceToggle` (docs/voice.md).
   */
  voice?: boolean;
  /** Web Speech constructor the owner detected after mount. Null keeps the typed row even when `voice` is on. */
  recognizer?: RecognizerCtor | null;
  /** BCP-47 the recognizer should listen in (Settings → Language). Unset leaves the browser default. */
  lang?: string;
  /** Hold-to-talk words. Auto-sent by the owner as a spoken turn; nothing lands in the textarea. */
  onVoice?: (text: string) => void;
  /** Kit's reply is being fetched or played; the hold bar says so. */
  speaking?: SpeakPhase;
  /** Stage a pick, shot, or paste on the draft. Nothing goes on the wire until Send. */
  onPhoto?: (file: File) => void;
  /** Encoded data URL sitting on the draft; Send is live with no text while it is set. */
  photo?: string | null;
  onPhotoClear?: () => void;
  onPin?: () => void;
  gpsHint?: string;
  gpsOn?: boolean;
  onGpsToggle?: () => void;
  onEngage?: () => void;
  commands?: boolean;
  catalog?: readonly SlashCommand[];
  initialText?: string;
  initialEmoji?: boolean;
}) {
  const [text, setText] = useState(() => applyEmoji(initialText, initialText.length, "send").text);
  const [dismissed, setDismissed] = useState(initialEmoji);
  const [active, setActive] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(initialEmoji);
  const [emojiQuery, setEmojiQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const onPhotoRef = useRef(onPhoto);
  onPhotoRef.current = onPhoto;
  const caretRef = useRef<number | null>(null);
  const insertAt = useRef(0);
  const composing = useRef(false);
  const listId = useId();
  const matches = useMemo(() => (commands ? matchSlash(text, catalog) : []), [catalog, commands, text]);
  const waiting = Boolean(commands && catalog.length === 0 && slashToken(text) != null);
  const open = Boolean(commands && !disabled && !dismissed && !emojiOpen && (matches.length > 0 || waiting));
  const highlight = matches[Math.min(active, Math.max(0, matches.length - 1))];
  const attach = Boolean(onPhoto || commands || onGpsToggle || onPin);
  const holdToTalk = Boolean(voice && onVoice && recognizer);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const caret = caretRef.current;
    if (!box || caret == null) {
      return;
    }
    box.setSelectionRange(caret, caret);
    caretRef.current = null;
  }, [text]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#compose") {
      boxRef.current?.focus();
    }
  }, []);

  const canPastePhoto = Boolean(onPhoto) && !disabled;
  useEffect(() => {
    if (!canPastePhoto) {
      return;
    }
    function onPaste(e: ClipboardEvent) {
      takePhotoPaste(e, onPhotoRef.current, boxRef.current);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canPastePhoto]);

  function setDraft(next: string, caret: number | null = null) {
    caretRef.current = caret;
    setText(next);
    setDismissed(false);
    setActive(0);
  }

  function writeDraft(raw: string, cursor: number) {
    if (composing.current) {
      setDraft(raw, null);
      return;
    }
    const next = applyEmoji(raw, cursor, "type");
    const caret = next.text === raw ? cursor : next.cursor;
    if (emojiOpen) {
      insertAt.current = caret;
    }
    setDraft(next.text, next.text === raw ? null : next.cursor);
  }

  function insertEmoji(emoji: string) {
    const box = boxRef.current;
    const focused = box != null && document.activeElement === box;
    const start = focused ? (box.selectionStart ?? text.length) : insertAt.current;
    const end = focused ? (box.selectionEnd ?? start) : start;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const caret = start + emoji.length;
    insertAt.current = caret;
    setDraft(next, caret);
    box?.focus();
  }

  function pick(cmd: SlashCommand) {
    setDraft(slashInsert(cmd));
    setDismissed(true);
    boxRef.current?.focus();
  }

  function sendDraft() {
    const t = applyEmoji(text, text.length, "send").text.trim();
    if ((!t && !photo) || disabled) {
      return;
    }
    onSend(t);
    setEmojiOpen(false);
    setDraft("");
  }

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    sendDraft();
  }

  function toggleCommands() {
    setEmojiOpen(false);
    if (open) {
      setDismissed(true);
      boxRef.current?.focus();
      return;
    }
    setDismissed(false);
    setActive(0);
    if (!text.startsWith("/") || /\s/.test(text)) {
      setText("/");
    }
    boxRef.current?.focus();
  }

  function toggleEmoji() {
    if (!emojiOpen) {
      insertAt.current = boxRef.current?.selectionStart ?? text.length;
    }
    setEmojiOpen((v) => !v);
    setEmojiQuery("");
    setDismissed(true);
  }

  /** Gallery pick and camera shot land on the same ladder and the same caps. */
  function takeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      onPhoto?.(f);
    }
    e.target.value = "";
  }

  return (
    <form onSubmit={submit} className="relative shrink-0 border-t border-line bg-panel p-3">
      {onPhoto
        ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={takeFile}
              />
              {/* `capture` opens the rear camera on a phone; a desktop browser ignores it and shows the picker. */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={takeFile}
              />
            </>
          )
        : null}
      {emojiOpen
        ? (
            <EmojiPanel
              query={emojiQuery}
              onQuery={setEmojiQuery}
              onPick={insertEmoji}
              onClose={() => setEmojiOpen(false)}
            />
          )
        : null}
      {open
        ? (
            <div
              id={listId}
              role="listbox"
              aria-label="Commands"
              className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-xl border border-accent-line bg-panel shadow-lg"
            >
              <div className="border-b border-line px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-mark">Commands</p>
                <p className="text-[11px] text-dim">These go to the agent, not the chat model.</p>
              </div>
              {waiting
                ? <p className="px-3 py-2 text-xs text-muted">Waiting for the agent to publish commands.</p>
                : null}
              {matches.map((cmd, i) => {
                const selected = cmd === highlight;
                return (
                  <button
                    key={cmd.name}
                    type="button"
                    role="option"
                    aria-label={`/${cmd.name} ${cmd.hint}`}
                    aria-selected={selected}
                    className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
                      selected ? "bg-accent-soft" : "hover:bg-track"
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(cmd)}
                  >
                    <span className="shrink-0 font-medium text-mark">/{cmd.name}</span>
                    <span className="min-w-0 truncate text-xs text-muted">{cmd.hint}</span>
                  </button>
                );
              })}
            </div>
          )
        : null}
      {photo
        ? (
            <div className="mb-2 flex items-center gap-2">
              <img src={photo} alt="Photo to send" className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover" />
              <p className="min-w-0 flex-1 text-xs text-dim">Goes with your next message.</p>
              <button
                type="button"
                aria-label="Remove photo"
                className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:bg-track"
                onClick={onPhotoClear}
              >
                Remove
              </button>
            </div>
          )
        : null}
      {holdToTalk && onVoice && recognizer
        ? (
            <HoldToTalk
              disabled={disabled}
              onText={onVoice}
              recognizer={recognizer}
              lang={lang}
              speaking={speaking}
              className="min-h-11 w-full px-3 py-2 text-base"
            />
          )
        : (
            <div className="flex items-stretch gap-2">
              <div className="flex min-h-11 min-w-0 flex-1 items-stretch rounded-xl border border-edge bg-canvas">
                <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 py-0.5 pl-0.5">
                  <EmojiButton
                    disabled={disabled}
                    open={emojiOpen}
                    onToggle={toggleEmoji}
                  />
                  {attach
                    ? (
                        <AttachChip
                          gpsOn={Boolean(onGpsToggle || onPin) && gpsOn}
                          gpsHint={gpsHint}
                          disabled={disabled}
                          onCamera={onPhoto ? () => cameraRef.current?.click() : undefined}
                          onPhoto={onPhoto ? () => fileRef.current?.click() : undefined}
                          onCommands={commands ? toggleCommands : undefined}
                          onToggle={onGpsToggle}
                          onPin={onPin}
                        />
                      )
                    : null}
                </div>
                <textarea
                  ref={boxRef}
                  id="compose"
                  className="block min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent py-2 pl-1 pr-3 text-chat text-fg outline-none"
                  rows={2}
                  value={text}
                  placeholder={placeholder ?? "Message"}
                  disabled={disabled}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={open}
                  aria-controls={open ? listId : undefined}
                  onChange={(e) => writeDraft(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                  onFocus={() => onEngage?.()}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    composing.current = false;
                    writeDraft(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length);
                  }}
                  onKeyDown={(e) => {
                    if (open && highlight) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActive((i) => (i + 1) % matches.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActive((i) => (i - 1 + matches.length) % matches.length);
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        pick(highlight);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setDismissed(true);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendDraft();
                    }
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={disabled || (!text.trim() && !photo)}
                className="flex shrink-0 items-center justify-center self-stretch rounded-xl border border-accent-line bg-accent-soft px-3 text-sm text-mark disabled:opacity-40"
              >
                Send
              </button>
            </div>
          )}
    </form>
  );
}

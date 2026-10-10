"use client";

import { useEffect, useRef, useState } from "react";
import { useDevicePermission } from "@/app/lib/permit";
import { hushSpeaker } from "@/app/lib/tts";
import { speakBarLabel, type SpeakPhase } from "@/lib/phone/speaker";
import { listen, recognitionCtor, type ListenHandle, type RecognizerCtor } from "@/lib/phone/speech";

export type HoldState = "idle" | "listening" | "finishing" | "blocked";

export const HOLD_LABEL: Record<HoldState, string> = {
  idle: "Hold to talk",
  listening: "Release to send",
  finishing: "…",
  blocked: "Mic blocked",
};

/** Null on the server and wherever Web Speech is missing (Firefox, iOS A2HS): no mic, no banner. */
export function browserRecognizer(): RecognizerCtor | null {
  return typeof window === "undefined" ? null : recognitionCtor(window);
}

function within(e: React.PointerEvent<HTMLButtonElement>): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

/**
 * Push-to-talk. Press starts one utterance, release commits it, sliding off the
 * button before release throws it away. The words go to `onText`; nothing is
 * typed into compose and nothing is spoken here — the owner sends the turn.
 */
export function HoldToTalk({
  disabled,
  onText,
  recognizer,
  lang,
  speaking = "idle",
  className = "shrink-0 self-stretch px-3 text-sm",
}: {
  disabled?: boolean;
  /** Final words of one hold. Empty holds and slide-off cancels never call this. */
  onText: (text: string) => void;
  recognizer: RecognizerCtor;
  lang?: string;
  /** Kit's reply in flight: the idle bar says so. A press still hushes and listens. */
  speaking?: SpeakPhase;
  /** Layout only. Default sits in the Send slot; voice mode passes a full-width bar. */
  className?: string;
}) {
  const [state, setState] = useState<HoldState>("idle");
  const handle = useRef<ListenHandle | null>(null);
  const outside = useRef(false);
  const blocked = useRef(false);
  const live = useRef(true);
  const mic = useDevicePermission("microphone");

  useEffect(() => () => {
    live.current = false;
    handle.current?.abort();
  }, []);

  useEffect(() => {
    if (mic === "granted") {
      blocked.current = false;
      setState((s) => (s === "blocked" ? "idle" : s));
    }
  }, [mic]);

  function begin() {
    if (disabled || handle.current) {
      return;
    }
    outside.current = false;
    blocked.current = false;
    hushSpeaker();
    try {
      handle.current = listen(recognizer, {
        lang,
        onDone: (text) => {
          handle.current = null;
          if (!live.current) {
            return;
          }
          setState(blocked.current ? "blocked" : "idle");
          if (text) {
            onText(text);
          }
        },
        onError: (code) => {
          if (code === "not-allowed" || code === "service-not-allowed") {
            blocked.current = true;
          }
        },
      });
    } catch {
      setState("blocked");
      return;
    }
    setState("listening");
  }

  function release() {
    const h = handle.current;
    if (!h) {
      return;
    }
    if (outside.current) {
      h.abort();
      return;
    }
    setState("finishing");
    h.stop();
  }

  function cancel() {
    handle.current?.abort();
  }

  const kitTalking = state === "idle" ? speakBarLabel(speaking) : "";

  return (
    <button
      type="button"
      aria-label="Hold to talk"
      aria-pressed={state === "listening"}
      title={state === "blocked" ? "Enable the microphone in Settings." : "Hold, speak, release to send. Slide off to cancel."}
      disabled={disabled || state === "finishing"}
      className={`flex touch-none select-none items-center justify-center rounded-xl border bg-accent-soft text-mark disabled:opacity-40 ${
        state === "listening" ? "animate-pulse border-ok" : kitTalking ? "border-ok text-ok" : "border-accent-line"
      } ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) {
          return;
        }
        e.preventDefault();
        if (typeof e.currentTarget.setPointerCapture === "function") {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        begin();
      }}
      onPointerMove={(e) => {
        if (handle.current) {
          outside.current = !within(e);
        }
      }}
      onPointerUp={release}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === " " && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " ") {
          e.preventDefault();
          release();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {kitTalking || HOLD_LABEL[state]}
    </button>
  );
}

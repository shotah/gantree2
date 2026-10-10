"use client";

import { useEffect, useState } from "react";
import {
  installHintOn,
  isIos,
  isStandalone,
  listenInstallPrompt,
  writeInstallHint,
  type InstallChoice,
} from "@/app/lib/install";

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M4 4l8 8M12 4l-8 8"
      />
    </svg>
  );
}

/** `signInFirst`: iOS copies Safari's session into a new Home Screen app, so order matters there. */
export function InstallApp({ placement, signInFirst = false }: { placement: "header" | "block"; signInFirst?: boolean }) {
  const [choice, setChoice] = useState<InstallChoice | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    setStandalone(isStandalone(window, navigator));
    setIos(isIos(navigator));
    setHint(installHintOn(window.localStorage));
    return listenInstallPrompt(setChoice, window);
  }, []);

  if (standalone) {
    return null;
  }

  if (placement === "header") {
    if (!choice || !hint) {
      return null;
    }
    return (
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="text-xs text-mark underline"
          onClick={() => void choice.prompt()}
        >
          Install
        </button>
        <button
          type="button"
          aria-label="Dismiss install"
          title="Dismiss"
          className="flex h-6 w-6 min-h-0 items-center justify-center rounded-md text-muted hover:bg-track hover:text-fg"
          onClick={() => {
            writeInstallHint(window.localStorage, false);
            setHint(false);
          }}
        >
          <CloseIcon />
        </button>
      </span>
    );
  }

  if (choice) {
    return (
      <button
        type="button"
        className="rounded-xl border border-accent-line bg-accent-soft px-4 py-2 text-sm text-mark"
        onClick={() => void choice.prompt()}
      >
        Install app
      </button>
    );
  }

  return (
    <p className="text-xs text-dim">
      {ios
        ? signInFirst
          ? "Sign in first, then Share → Add to Home Screen"
          : "Share → Add to Home Screen"
        : "Chrome menu → Cast, save and share → Install gantree"}
    </p>
  );
}

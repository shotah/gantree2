"use client";

function MicIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
      <rect x="7" y="2.5" width="6" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5M7.5 17.5h5"
      />
    </svg>
  );
}

/**
 * Header switch between typing (default) and hold-to-talk. Sits left of the
 * settings cog. Not rendered at all when the browser has no Web Speech, so a
 * Firefox or iPhone Home Screen user never sees a mic that cannot listen.
 */
export function VoiceToggle({
  on,
  speaking = false,
  onToggle,
}: {
  on: boolean;
  /** Kit's reply is playing: the mic pulses so the eye knows where the sound is coming from. */
  speaking?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={on ? "Voice on" : "Voice off"}
      aria-pressed={on}
      title={speaking ? "Kit is speaking" : on ? "Hold to talk is on · tap to type" : "Tap to talk instead of type"}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-track ${
        on ? "bg-accent-soft text-mark" : "text-muted hover:text-fg"
      } ${speaking ? "animate-pulse text-ok" : ""}`}
      onClick={onToggle}
    >
      <MicIcon />
    </button>
  );
}

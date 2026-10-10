/**
 * Kit's pocket voice as the phone sees it. `browserSpeak` reports these
 * events; the shell paints them so a silent reply is never a mystery.
 */

export type SpeakPhase = "idle" | "fetching" | "playing";

/** Why a reply stayed silent. `empty` (nothing speakable) is not worth a line. */
export type SpeakFail = "empty" | "offline" | "no-voice" | "unauthorized" | "busy" | "vendor" | "play";

export type SpeakEvent
  = | { phase: "fetching" }
    | { phase: "playing" }
    | { phase: "done" }
    | { phase: "failed"; reason: SpeakFail };

/** `/api/chat/tts` status → reason. 404 is the Worker not offering voice; 5xx is Google. */
export function speakFailFromStatus(status: number): SpeakFail {
  if (status === 404) {
    return "no-voice";
  }
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "busy";
  }
  return "vendor";
}

/** Live phase after an event; done and failed both go quiet. */
export function speakPhaseAfter(ev: SpeakEvent): SpeakPhase {
  return ev.phase === "fetching" || ev.phase === "playing" ? ev.phase : "idle";
}

/** Header words next to `live`. "" when the speaker is quiet. */
export function speakStatus(phase: SpeakPhase): string {
  if (phase === "fetching") {
    return "voice…";
  }
  if (phase === "playing") {
    return "speaking";
  }
  return "";
}

/** Hold-bar words while idle and Kit is talking. "" hands the bar back to "Hold to talk". */
export function speakBarLabel(phase: SpeakPhase): string {
  if (phase === "fetching") {
    return "Fetching voice…";
  }
  if (phase === "playing") {
    return "Speaking · hold to cut in";
  }
  return "";
}

/** One line under the header when a reply stayed silent. "" for nothing-to-say. */
export function speakFailHint(reason: SpeakFail): string {
  switch (reason) {
    case "no-voice":
      return "Kit's voice is off on this Worker (no TTS key, or VOICE=off).";
    case "unauthorized":
      return "Kit's voice: sign in again.";
    case "busy":
      return "Kit's voice: too many requests, try again in a moment.";
    case "vendor":
      return "Kit's voice failed at Google. Check the Cloud Text-to-Speech API and the key restriction.";
    case "offline":
      return "Kit's voice: could not reach the Worker.";
    case "play":
      return "Kit's voice: the browser would not play. Tap the thread, then hold again.";
    default:
      return "";
  }
}

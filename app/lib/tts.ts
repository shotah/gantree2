import type { LangId } from "@/lib/phone/lang";
import { clipForSpeech, speakable } from "@/lib/phone/speakable";
import { speakFailFromStatus, type SpeakEvent } from "@/lib/phone/speaker";

export const TTS_PATH = "/api/chat/tts";

/** One speaker per tab. A second reply replaces the first instead of talking over it. */
let speaker: HTMLAudioElement | null = null;
let playingUrl = "";
/** Tells the reply that is playing right now that it stopped (hushed or replaced). */
let settle: (() => void) | null = null;

function speakerAudio(): HTMLAudioElement {
  speaker ??= new Audio();
  return speaker;
}

function dropUrl(): void {
  if (playingUrl) {
    URL.revokeObjectURL(playingUrl);
    playingUrl = "";
  }
}

/** Hold pressed while Kit is mid-sentence: quiet the speaker so the mic does not hear Kit. */
export function hushSpeaker(): void {
  settle?.();
  if (!speaker) {
    return;
  }
  speaker.pause();
  speaker.removeAttribute("src");
  dropUrl();
}

export type SpeakDeps = {
  fetch?: typeof fetch;
  audio?: HTMLAudioElement;
  /** Progress for the shell to paint: fetching → playing → done, or failed with a reason. */
  onPhase?: (ev: SpeakEvent) => void;
  /** Settings → Language. The Worker swaps Chirp's locale; unset keeps its `TTS_VOICE`. */
  lang?: LangId;
};

/**
 * Reply markdown → words → `/api/chat/tts` → play. Resolves false when there was
 * nothing to say, the Worker declined (404 until the key is set, 401, 502), or
 * the browser refused to play. The reply is already on screen either way;
 * `onPhase` is how the shell says *why* it stayed quiet.
 */
export async function browserSpeak(markdown: string, deps: SpeakDeps = {}): Promise<boolean> {
  const tell = deps.onPhase ?? (() => undefined);
  const text = clipForSpeech(speakable(markdown));
  if (!text) {
    tell({ phase: "failed", reason: "empty" });
    return false;
  }
  tell({ phase: "fetching" });
  const fetchFn = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(TTS_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deps.lang ? { text, lang: deps.lang } : { text }),
    });
  } catch {
    tell({ phase: "failed", reason: "offline" });
    return false;
  }
  if (!res.ok) {
    tell({ phase: "failed", reason: speakFailFromStatus(res.status) });
    return false;
  }
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    tell({ phase: "failed", reason: "vendor" });
    return false;
  }
  const audio = deps.audio ?? speakerAudio();
  audio.pause();
  dropUrl();
  settle?.();
  const url = URL.createObjectURL(blob);
  playingUrl = url;
  audio.src = url;
  let over = false;
  const done = (ev: SpeakEvent) => {
    if (over) {
      return;
    }
    over = true;
    if (playingUrl === url) {
      dropUrl();
    }
    if (settle === finish) {
      settle = null;
    }
    tell(ev);
  };
  const finish = () => done({ phase: "done" });
  settle = finish;
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", () => done({ phase: "failed", reason: "play" }), { once: true });
  try {
    await audio.play();
  } catch {
    done({ phase: "failed", reason: "play" });
    return false;
  }
  tell({ phase: "playing" });
  return true;
}

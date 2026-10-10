/**
 * Web Speech in, one utterance at a time. Chrome Android is the walk; the
 * recognizer sends audio to Google's speech stack and hands back words. The
 * mailbox and the crane only ever see the words (docs/voice.md).
 *
 * `lib.dom` types the result events but not the recognizer object, so the
 * shape we touch is spelled out here and a test can hand in a fake.
 */

export type RecognizerResult = { isFinal: boolean } & ArrayLike<{ transcript: string }>;

export type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<RecognizerResult> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type RecognizerCtor = new () => Recognizer;

type SpeechWindow = {
  SpeechRecognition?: RecognizerCtor;
  webkitSpeechRecognition?: RecognizerCtor;
};

/** Standard name first, Chrome's prefix second, nothing on Firefox / iOS A2HS. */
export function recognitionCtor(win: unknown): RecognizerCtor | null {
  if (!win || typeof win !== "object") {
    return null;
  }
  const w = win as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Final alternatives only, in order; interim guesses are not words yet. */
export function finalTranscript(results: ArrayLike<RecognizerResult>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const best = r?.isFinal ? r[0]?.transcript?.trim() : "";
    if (best) {
      foldSpoken(parts, best);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Chrome/Gecko `continuous` often reports each longer hypothesis as a *new*
 * final (`well`, then `well I`, then `well I can send`…). Joining those is a
 * stutter. A later result that grows the previous one replaces it; a new
 * sentence still appends.
 */
function growsSpoken(earlier: string, later: string): boolean {
  const a = earlier.trim().replace(/\s+/g, " ").toLowerCase();
  const b = later.trim().replace(/\s+/g, " ").toLowerCase();
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (!b.startsWith(a)) {
    return false;
  }
  const next = b.charAt(a.length);
  return next === " " || /[.,!?;:'")\]]/.test(next);
}

function foldSpoken(parts: string[], next: string): void {
  const t = next.trim().replace(/\s+/g, " ");
  if (!t) {
    return;
  }
  const last = parts[parts.length - 1];
  if (!last) {
    parts.push(t);
    return;
  }
  if (growsSpoken(last, t)) {
    parts[parts.length - 1] = t;
    return;
  }
  if (growsSpoken(t, last)) {
    return;
  }
  parts.push(t);
}

/**
 * Best words in this result list: all finals, plus the trailing interim so a
 * release that never gets `isFinal` (Chrome Android) still has something to send.
 */
export function spokenFrom(results: ArrayLike<RecognizerResult>): string {
  const parts: string[] = [];
  let interim = "";
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const t = r?.[0]?.transcript?.trim() ?? "";
    if (!t) {
      continue;
    }
    if (r.isFinal) {
      foldSpoken(parts, t);
      interim = "";
    } else {
      interim = t;
    }
  }
  if (interim) {
    foldSpoken(parts, interim);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export const LISTEN_END_MS = 2_000;

export type ListenHandle = {
  /** Release: let the recognizer finish the utterance, then `onDone` fires with the words. */
  stop(): void;
  /** Slide-off cancel: drop what was heard; `onDone` fires with "". */
  abort(): void;
};

export type ListenOpts = {
  lang?: string;
  /** Once per utterance, after the recognizer ends. Empty when nothing was heard or the hold was cancelled. */
  onDone: (text: string) => void;
  /** Web Speech error code (`not-allowed`, `no-speech`, `network`, `aborted`, …). */
  onError?: (code: string) => void;
};

/**
 * Hold-to-talk listen. `continuous` so release is the commit (Chrome Android
 * otherwise waits for end-of-utterance and often never fires `onend` after
 * `stop()`). Interim results are kept as a fallback when a final never lands.
 * `stop()` always reaches `onDone` — via `onend`, or a 2s watchdog, or if
 * `stop()` throws because `start()` has not finished.
 */
export function listen(Ctor: RecognizerCtor, opts: ListenOpts): ListenHandle {
  const rec = new Ctor();
  if (opts.lang) {
    rec.lang = opts.lang;
  }
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let heard = "";
  let ended = false;
  let wait: ReturnType<typeof setTimeout> | undefined;
  function finish(): void {
    if (ended) {
      return;
    }
    ended = true;
    if (wait !== undefined) {
      clearTimeout(wait);
      wait = undefined;
    }
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    opts.onDone(heard);
  }
  function waitForEnd(): void {
    if (ended || wait !== undefined) {
      return;
    }
    wait = setTimeout(finish, LISTEN_END_MS);
  }
  rec.onresult = (ev) => {
    heard = spokenFrom(ev.results);
  };
  rec.onerror = (ev) => {
    opts.onError?.(ev.error);
  };
  rec.onend = () => finish();
  rec.start();
  return {
    stop: () => {
      if (ended) {
        return;
      }
      try {
        rec.stop();
      } catch {
        finish();
        return;
      }
      waitForEnd();
    },
    abort: () => {
      heard = "";
      try {
        rec.abort();
      } catch {
        finish();
        return;
      }
      finish();
    },
  };
}

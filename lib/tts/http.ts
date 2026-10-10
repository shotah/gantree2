/**
 * Kit's voice for the pocket: text in, MP3 out, Google Cloud Text-to-Speech
 * (Chirp 3 HD) on the same GCP bill as the OAuth client. The Worker is a proxy
 * with the key. Nothing is stored, nothing is a frame, the Durable Object never
 * sees it (docs/voice.md). Never log the text.
 */

import { readChatUser } from "@/lib/avatar/http";
import { headerSaysTooLarge, utf8Bytes } from "@/lib/chat/caps";
import type { DoorEnv } from "@/lib/door/http";
import type { UserStore } from "@/lib/door/users";
import { langIdOf, ttsLocale, type LangId } from "../phone/lang";
import { SPEAK_BYTES_MAX } from "../phone/speakable";

export const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
/** Chirp 3 HD, `<locale>-<model>-<voice>`. Every Chirp 3 HD speaker exists in every locale. */
const CHIRP_DEFAULT_SPEAKER = "Chirp3-HD-Leda";
/** Chirp 3 HD, `<locale>-Chirp3-HD-<voice>`. Override with the `TTS_VOICE` var. */
export const TTS_VOICE_DEFAULT = `en-US-${CHIRP_DEFAULT_SPEAKER}`;
/** Request JSON cap; the text inside is capped tighter by `SPEAK_BYTES_MAX`. */
export const TTS_JSON_MAX = 16_384;

export type TtsEnv = {
  GOOGLE_TTS_API_KEY?: string;
  TTS_VOICE?: string;
  /** `on` / `off`. Unset follows the key: offered only when `GOOGLE_TTS_API_KEY` is set. */
  VOICE?: string;
};

export type TtsConfig = {
  apiKey: string;
  voice: string;
  languageCode: string;
};

/** `en-US-Chirp3-HD-Leda` → `en-US`. Google wants both fields even though the name implies the locale. */
export function languageOf(voice: string): string {
  const m = /^([a-z]{2,3}-[A-Za-z]{2,4})-/i.exec(voice.trim());
  return m?.[1] ?? "en-US";
}

/**
 * Whether the Worker publishes pocket voice (header mic + `/api/chat/tts`).
 * Default: on when the TTS key exists. `VOICE=off` hides it even with a key
 * (you do not want it on this origin). `VOICE=on` shows the mic without a key
 * so hold-to-talk can still dictate; replies stay on screen until Chirp is set.
 */
export function voiceOffered(env: TtsEnv): boolean {
  const flag = env.VOICE?.trim().toLowerCase();
  if (flag === "off") {
    return false;
  }
  if (flag === "on") {
    return true;
  }
  return Boolean(env.GOOGLE_TTS_API_KEY?.trim());
}

/** Null until the key is set, so the route answers 404 like Web Push does without VAPID. */
export function readTts(env: TtsEnv): TtsConfig | null {
  const apiKey = env.GOOGLE_TTS_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return null;
  }
  const voice = env.TTS_VOICE?.trim() || TTS_VOICE_DEFAULT;
  return { apiKey, voice, languageCode: languageOf(voice) };
}

export type TtsBody = { ok: true; text: string; lang?: LangId } | { ok: false; error: "bad frame" | "too large" };

/**
 * `{ text, lang? }`. Blank is a bad frame, not a silent 200. `lang` is the
 * phone's Settings → Language (`en` | `ja` | `zh` | `vi`); unknown or missing is
 * dropped, not refused, so an old mouth that sends `{ text }` still speaks.
 */
export function parseTtsBody(raw: unknown): TtsBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "bad frame" };
  }
  const o = raw as Record<string, unknown>;
  const text = o.text;
  if (typeof text !== "string") {
    return { ok: false, error: "bad frame" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "bad frame" };
  }
  if (utf8Bytes(trimmed) > SPEAK_BYTES_MAX) {
    return { ok: false, error: "too large" };
  }
  const lang = langIdOf(o.lang);
  return lang ? { ok: true, text: trimmed, lang } : { ok: true, text: trimmed };
}

/**
 * Same speaker, other tongue: `en-US-Chirp3-HD-Leda` + `ja` → `ja-JP-Chirp3-HD-Leda`.
 * `TTS_VOICE` still picks *who* talks; the phone picks *what language*. A voice
 * already in that language (`en-GB-…` for `en`) is kept, so a deployer's accent
 * wins inside its own language. A `TTS_VOICE` that is not `<locale>-…` shaped
 * falls back to Leda in the asked-for locale.
 */
export function voiceFor(cfg: TtsConfig, lang: LangId): TtsConfig {
  const locale = ttsLocale(lang);
  if (primaryTag(cfg.languageCode) === primaryTag(locale)) {
    return cfg;
  }
  const prefix = `${cfg.languageCode}-`;
  const speaker = cfg.voice.startsWith(prefix) ? cfg.voice.slice(prefix.length) : CHIRP_DEFAULT_SPEAKER;
  return { ...cfg, voice: `${locale}-${speaker}`, languageCode: locale };
}

/** `en-GB` → `en`, `cmn-CN` → `cmn`. */
function primaryTag(locale: string): string {
  return locale.split("-")[0] ?? locale;
}

/** Plain `text` input. Chirp 3 HD reads punctuation as pauses; the mouth already stripped markdown. */
export function synthesizeRequest(cfg: TtsConfig, text: string): Request {
  return new Request(TTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": cfg.apiKey,
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: cfg.languageCode, name: cfg.voice },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
}

function base64Bytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/** One synth round trip. A vendor error is a 502 with no detail; the phone just stays quiet. */
export async function synthesize(cfg: TtsConfig, text: string, fetchFn: typeof fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(synthesizeRequest(cfg, text));
  } catch {
    return ttsFailed();
  }
  if (!res.ok) {
    return ttsFailed();
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return ttsFailed();
  }
  const b64 = body && typeof body === "object" ? (body as Record<string, unknown>).audioContent : undefined;
  const bytes = typeof b64 === "string" && b64 ? base64Bytes(b64) : null;
  if (!bytes?.byteLength) {
    return ttsFailed();
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

export function ttsFailed(): Response {
  return Response.json({ error: "tts" }, { status: 502 });
}

function tooLarge(): Response {
  return Response.json({ error: "too large" }, { status: 413 });
}

function badFrame(): Response {
  return Response.json({ error: "bad frame" }, { status: 400 });
}

/** GET says whether pocket voice is offered. POST speaks `{ text, lang? }` for a signed-in person. */
export async function handleTts(
  req: Request,
  env: DoorEnv & TtsEnv,
  store: UserStore,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (req.method === "GET") {
    return voiceOffered(env) ? Response.json({ voice: true }) : new Response(null, { status: 404 });
  }
  if (req.method !== "POST") {
    return new Response("method", { status: 405 });
  }
  if (!voiceOffered(env)) {
    return new Response(null, { status: 404 });
  }
  const cfg = readTts(env);
  if (!cfg) {
    return new Response(null, { status: 404 });
  }
  const who = await readChatUser(req, env, store);
  if ("response" in who) {
    return who.response;
  }
  if (headerSaysTooLarge(req.headers.get("content-length"), TTS_JSON_MAX)) {
    return tooLarge();
  }
  let buf: ArrayBuffer;
  try {
    buf = await req.arrayBuffer();
  } catch {
    return badFrame();
  }
  if (buf.byteLength > TTS_JSON_MAX) {
    return tooLarge();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf)) as unknown;
  } catch {
    return badFrame();
  }
  const parsed = parseTtsBody(raw);
  if (!parsed.ok) {
    return parsed.error === "too large" ? tooLarge() : badFrame();
  }
  return synthesize(parsed.lang ? voiceFor(cfg, parsed.lang) : cfg, parsed.text, fetchFn);
}

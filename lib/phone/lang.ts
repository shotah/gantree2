/**
 * Settings → Language. One closed set for the mouth's ears and Kit's voice:
 * the Web Speech `lang` for hold-to-talk and the Chirp 3 HD locale the Worker
 * swaps in on `POST /api/chat/tts { text, lang }`. Not on the mailbox wire — voice
 * is mouth-local (docs/voice.md). Cab and Helm mirror this table
 * (docs/frontends.md). Mandarin is `zh-CN` to a recognizer but `cmn-CN` to
 * Google TTS, which is why the row carries both.
 */
export const LANGUAGES = [
  { id: "en", label: "English", speech: "en-US", tts: "en-US" },
  { id: "ja", label: "日本語 · Japanese", speech: "ja-JP", tts: "ja-JP" },
  { id: "zh", label: "中文 · Mandarin", speech: "zh-CN", tts: "cmn-CN" },
  { id: "vi", label: "Tiếng Việt · Vietnamese", speech: "vi-VN", tts: "vi-VN" },
] as const;

export type LangId = (typeof LANGUAGES)[number]["id"];

export const DEFAULT_LANG: LangId = "en";

/** A known id, or undefined. Junk from storage or a request body is not a language. */
export function langIdOf(v: unknown): LangId | undefined {
  return LANGUAGES.find((l) => l.id === v)?.id;
}

/** Settings pref: junk or missing → English. */
export function parseLang(v: unknown): LangId {
  return langIdOf(v) ?? DEFAULT_LANG;
}

function rowOf(id: LangId) {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0];
}

/** BCP-47 for `SpeechRecognition.lang` (Android `EXTRA_LANGUAGE`, iOS `SFSpeechRecognizer` locale). */
export function speechLang(id: LangId): string {
  return rowOf(id).speech;
}

/** Google Cloud TTS locale for the Chirp 3 HD voice name — `cmn-CN`, not `zh-CN`, for Mandarin. */
export function ttsLocale(id: LangId): string {
  return rowOf(id).tts;
}

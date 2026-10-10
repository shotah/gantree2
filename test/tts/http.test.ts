import { describe, expect, it, vi } from "vitest";
import { SPEAK_BYTES_MAX } from "@/lib/phone/speakable";
import {
  languageOf,
  parseTtsBody,
  readTts,
  synthesize,
  synthesizeRequest,
  TTS_ENDPOINT,
  TTS_VOICE_DEFAULT,
  voiceFor,
  voiceOffered,
} from "@/lib/tts/http";

const cfg = { apiKey: "k", voice: "en-US-Chirp3-HD-Leda", languageCode: "en-US" };

function googleOk(bytes: number[]): Response {
  const b64 = btoa(String.fromCharCode(...bytes));
  return Response.json({ audioContent: b64 });
}

describe("voiceOffered", () => {
  it("follows the key unless VOICE is on or off", () => {
    expect(voiceOffered({})).toBe(false);
    expect(voiceOffered({ GOOGLE_TTS_API_KEY: "  " })).toBe(false);
    expect(voiceOffered({ GOOGLE_TTS_API_KEY: "k" })).toBe(true);
    expect(voiceOffered({ GOOGLE_TTS_API_KEY: "k", VOICE: "off" })).toBe(false);
    expect(voiceOffered({ GOOGLE_TTS_API_KEY: "k", VOICE: " OFF " })).toBe(false);
    expect(voiceOffered({ VOICE: "on" })).toBe(true);
    expect(voiceOffered({ VOICE: "yes" })).toBe(false);
  });
});

describe("readTts", () => {
  it("is null without a key and defaults the voice with it", () => {
    expect(readTts({})).toBeNull();
    expect(readTts({ GOOGLE_TTS_API_KEY: "  " })).toBeNull();
    expect(readTts({ GOOGLE_TTS_API_KEY: "k" })).toEqual({
      apiKey: "k",
      voice: TTS_VOICE_DEFAULT,
      languageCode: "en-US",
    });
    expect(readTts({ GOOGLE_TTS_API_KEY: "k", TTS_VOICE: " en-GB-Chirp3-HD-Puck " })).toEqual({
      apiKey: "k",
      voice: "en-GB-Chirp3-HD-Puck",
      languageCode: "en-GB",
    });
  });

  it("reads the locale off the voice name", () => {
    expect(languageOf("en-US-Chirp3-HD-Leda")).toBe("en-US");
    expect(languageOf("de-DE-Chirp3-HD-Kore")).toBe("de-DE");
    expect(languageOf("cmn-CN-Chirp3-HD-Aoede")).toBe("cmn-CN");
    expect(languageOf("nonsense")).toBe("en-US");
  });
});

describe("parseTtsBody", () => {
  it("takes trimmed text and refuses blanks, non-objects, and non-strings", () => {
    expect(parseTtsBody({ text: "  hi there  " })).toEqual({ ok: true, text: "hi there" });
    expect(parseTtsBody({ text: "   " })).toEqual({ ok: false, error: "bad frame" });
    expect(parseTtsBody({ text: 3 })).toEqual({ ok: false, error: "bad frame" });
    expect(parseTtsBody({})).toEqual({ ok: false, error: "bad frame" });
    expect(parseTtsBody(null)).toEqual({ ok: false, error: "bad frame" });
    expect(parseTtsBody(["x"])).toEqual({ ok: false, error: "bad frame" });
    expect(parseTtsBody("x")).toEqual({ ok: false, error: "bad frame" });
  });

  it("caps at the Chirp budget", () => {
    expect(parseTtsBody({ text: "a".repeat(SPEAK_BYTES_MAX) }).ok).toBe(true);
    expect(parseTtsBody({ text: "a".repeat(SPEAK_BYTES_MAX + 1) })).toEqual({ ok: false, error: "too large" });
    expect(parseTtsBody({ text: "é".repeat(SPEAK_BYTES_MAX / 2 + 1) })).toEqual({ ok: false, error: "too large" });
  });

  it("keeps a known lang and drops junk instead of refusing the turn", () => {
    expect(parseTtsBody({ text: "こんにちは", lang: "ja" })).toEqual({ ok: true, text: "こんにちは", lang: "ja" });
    expect(parseTtsBody({ text: "你好", lang: "zh" })).toEqual({ ok: true, text: "你好", lang: "zh" });
    expect(parseTtsBody({ text: "hi", lang: "en" })).toEqual({ ok: true, text: "hi", lang: "en" });
    // An old mouth sends `{ text }`; a confused one sends BCP-47. Both still speak in the Worker's voice.
    expect(parseTtsBody({ text: "hi" })).toEqual({ ok: true, text: "hi" });
    expect(parseTtsBody({ text: "hi", lang: "ja-JP" })).toEqual({ ok: true, text: "hi" });
    expect(parseTtsBody({ text: "hi", lang: 7 })).toEqual({ ok: true, text: "hi" });
  });
});

describe("voiceFor", () => {
  it("keeps the speaker and swaps the locale for another language", () => {
    expect(voiceFor(cfg, "ja")).toEqual({ apiKey: "k", voice: "ja-JP-Chirp3-HD-Leda", languageCode: "ja-JP" });
    expect(voiceFor(cfg, "zh")).toEqual({ apiKey: "k", voice: "cmn-CN-Chirp3-HD-Leda", languageCode: "cmn-CN" });
    expect(voiceFor(cfg, "vi")).toEqual({ apiKey: "k", voice: "vi-VN-Chirp3-HD-Leda", languageCode: "vi-VN" });
    const puck = { apiKey: "k", voice: "en-GB-Chirp3-HD-Puck", languageCode: "en-GB" };
    expect(voiceFor(puck, "ja").voice).toBe("ja-JP-Chirp3-HD-Puck");
  });

  it("leaves a voice that already speaks that language alone, accent included", () => {
    expect(voiceFor(cfg, "en")).toBe(cfg);
    const puck = { apiKey: "k", voice: "en-GB-Chirp3-HD-Puck", languageCode: "en-GB" };
    expect(voiceFor(puck, "en")).toBe(puck);
    const aoede = { apiKey: "k", voice: "cmn-CN-Chirp3-HD-Aoede", languageCode: "cmn-CN" };
    expect(voiceFor(aoede, "zh")).toBe(aoede);
  });

  it("falls back to Leda in the asked-for locale when TTS_VOICE is not locale-shaped", () => {
    const odd = { apiKey: "k", voice: "nonsense", languageCode: "en-US" };
    expect(voiceFor(odd, "ja")).toEqual({ apiKey: "k", voice: "ja-JP-Chirp3-HD-Leda", languageCode: "ja-JP" });
  });
});

describe("synthesizeRequest", () => {
  it("posts plain text to Google with the key in a header, never the URL", async () => {
    const req = synthesizeRequest(cfg, "Rain after eight.");
    expect(req.url).toBe(TTS_ENDPOINT);
    expect(req.url).not.toContain("k");
    expect(req.method).toBe("POST");
    expect(req.headers.get("X-Goog-Api-Key")).toBe("k");
    expect(req.headers.get("Content-Type")).toBe("application/json");
    expect(await req.json()).toEqual({
      input: { text: "Rain after eight." },
      voice: { languageCode: "en-US", name: "en-US-Chirp3-HD-Leda" },
      audioConfig: { audioEncoding: "MP3" },
    });
  });
});

describe("synthesize", () => {
  it("decodes audioContent into MP3 bytes with no-store", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => googleOk([0xff, 0xfb, 0x90, 0x00]));
    const res = await synthesize(cfg, "hi", fetchFn);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0xff, 0xfb, 0x90, 0x00]);
    expect(fetchFn).toHaveBeenCalledOnce();
    const sent = fetchFn.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe(TTS_ENDPOINT);
  });

  it("answers 502 with no detail on a vendor error, junk JSON, empty audio, or a thrown fetch", async () => {
    const bad = vi.fn(async () => new Response("denied", { status: 403 }));
    expect((await synthesize(cfg, "hi", bad as unknown as typeof fetch)).status).toBe(502);
    const junk = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect((await synthesize(cfg, "hi", junk as unknown as typeof fetch)).status).toBe(502);
    const empty = vi.fn(async () => Response.json({ audioContent: "" }));
    expect((await synthesize(cfg, "hi", empty as unknown as typeof fetch)).status).toBe(502);
    const notB64 = vi.fn(async () => Response.json({ audioContent: "!!!" }));
    expect((await synthesize(cfg, "hi", notB64 as unknown as typeof fetch)).status).toBe(502);
    const missing = vi.fn(async () => Response.json({ nope: 1 }));
    expect((await synthesize(cfg, "hi", missing as unknown as typeof fetch)).status).toBe(502);
    const thrown = vi.fn(async () => {
      throw new Error("net");
    });
    const res = await synthesize(cfg, "hi", thrown);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "tts" });
  });
});

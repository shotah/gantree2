import { describe, expect, it } from "vitest";
import { DEFAULT_LANG, LANGUAGES, langIdOf, parseLang, speechLang, ttsLocale } from "@/lib/phone/lang";

describe("language catalog", () => {
  it("is English, Japanese, Mandarin, Vietnamese — English first and default", () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual(["en", "ja", "zh", "vi"]);
    expect(DEFAULT_LANG).toBe("en");
    expect(LANGUAGES.map((l) => l.label)).toEqual(["English", "日本語 · Japanese", "中文 · Mandarin", "Tiếng Việt · Vietnamese"]);
  });

  it("only knows its own ids; junk is not a language", () => {
    expect(langIdOf("ja")).toBe("ja");
    expect(langIdOf("zh")).toBe("zh");
    expect(langIdOf("ja-JP")).toBeUndefined();
    expect(langIdOf("JA")).toBeUndefined();
    expect(langIdOf("")).toBeUndefined();
    expect(langIdOf(null)).toBeUndefined();
    expect(langIdOf(3)).toBeUndefined();
  });

  it("parses a pref back to English on junk or missing", () => {
    expect(parseLang("zh")).toBe("zh");
    expect(parseLang("klingon")).toBe("en");
    expect(parseLang(undefined)).toBe("en");
    expect(parseLang(null)).toBe("en");
  });

  it("gives Web Speech a BCP-47 tag and Google TTS its own locale", () => {
    expect(speechLang("en")).toBe("en-US");
    expect(speechLang("ja")).toBe("ja-JP");
    expect(speechLang("zh")).toBe("zh-CN");
    expect(speechLang("vi")).toBe("vi-VN");
    expect(ttsLocale("en")).toBe("en-US");
    expect(ttsLocale("ja")).toBe("ja-JP");
    // Chirp 3 HD spells Mandarin `cmn-CN`; a recognizer wants `zh-CN`.
    expect(ttsLocale("zh")).toBe("cmn-CN");
    expect(ttsLocale("vi")).toBe("vi-VN");
  });
});

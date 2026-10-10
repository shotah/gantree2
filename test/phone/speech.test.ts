import { describe, expect, it, vi } from "vitest";
import {
  finalTranscript,
  listen,
  LISTEN_END_MS,
  recognitionCtor,
  spokenFrom,
  type Recognizer,
  type RecognizerResult,
} from "@/lib/phone/speech";

function result(transcript: string, isFinal = true): RecognizerResult {
  return { isFinal, length: 1, 0: { transcript } };
}

class FakeRecognizer implements Recognizer {
  static instances: FakeRecognizer[] = [];
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 3;
  onresult: Recognizer["onresult"] = null;
  onerror: Recognizer["onerror"] = null;
  onend: Recognizer["onend"] = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  });

  constructor() {
    FakeRecognizer.instances.push(this);
  }

  hear(...parts: RecognizerResult[]) {
    this.onresult?.({ results: parts });
  }
}

describe("recognitionCtor", () => {
  it("prefers the standard name, falls back to webkit, and is null when neither exists", () => {
    const std = class {} as never;
    const webkit = class {} as never;
    expect(recognitionCtor({ SpeechRecognition: std, webkitSpeechRecognition: webkit })).toBe(std);
    expect(recognitionCtor({ webkitSpeechRecognition: webkit })).toBe(webkit);
    expect(recognitionCtor({})).toBeNull();
    expect(recognitionCtor(undefined)).toBeNull();
    expect(recognitionCtor(null)).toBeNull();
  });
});

describe("finalTranscript", () => {
  it("joins final alternatives and skips interim ones", () => {
    expect(finalTranscript([result("turn left", true), result("maybe", false), result(" at the light ", true)]))
      .toBe("turn left at the light");
    expect(finalTranscript([result("guess", false)])).toBe("");
    expect(finalTranscript([])).toBe("");
  });
});

describe("spokenFrom", () => {
  it("keeps finals and the trailing interim so a hung stop still has words", () => {
    expect(spokenFrom([
      result("how is", true),
      result("it going", false),
    ])).toBe("how is it going");
    expect(spokenFrom([result("guess", false)])).toBe("guess");
    expect(spokenFrom([result("done", true), result("x", false), result("really", true)])).toBe("done really");
    expect(spokenFrom([])).toBe("");
  });

  it("collapses growing finals so a hold is one sentence, not a stutter", () => {
    expect(spokenFrom([
      result("well", true),
      result("well I", true),
      result("well I can send", true),
      result("well I can send you a message but it's not reading it aloud back to me", true),
    ])).toBe("well I can send you a message but it's not reading it aloud back to me");
    expect(spokenFrom([
      result("well", true),
      result("well I can send you a message", false),
    ])).toBe("well I can send you a message");
    expect(spokenFrom([result("yes", true), result("yesterday", true)])).toBe("yes yesterday");
    expect(spokenFrom([result("turn left", true), result("at the light", true)])).toBe("turn left at the light");
  });
});

describe("listen", () => {
  it("configures a hold-to-talk recognizer and hands back the words once on end", () => {
    FakeRecognizer.instances = [];
    const onDone = vi.fn();
    const handle = listen(FakeRecognizer, { lang: "en-US", onDone });
    const rec = FakeRecognizer.instances[0];
    expect(rec.start).toHaveBeenCalledOnce();
    expect(rec.lang).toBe("en-US");
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.maxAlternatives).toBe(1);
    rec.hear(result("where is"), result("the nearest gas"));
    handle.stop();
    expect(rec.stop).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledExactlyOnceWith("where is the nearest gas");
    rec.onend?.();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("still finishes with the words if Chrome never fires onend after stop", () => {
    vi.useFakeTimers();
    FakeRecognizer.instances = [];
    class Quiet extends FakeRecognizer {
      stop = vi.fn();
    }
    const onDone = vi.fn();
    const handle = listen(Quiet, { onDone });
    const rec = FakeRecognizer.instances[0];
    rec.hear(result("how are you"));
    handle.stop();
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LISTEN_END_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledExactlyOnceWith("how are you");
    vi.useRealTimers();
  });

  it("finishes immediately when stop throws because start has not finished", () => {
    FakeRecognizer.instances = [];
    class ThrowsStop extends FakeRecognizer {
      stop = vi.fn(() => {
        throw new Error("InvalidStateError");
      });
    }
    const onDone = vi.fn();
    const handle = listen(ThrowsStop, { onDone });
    FakeRecognizer.instances[0].hear(result("hi"));
    handle.stop();
    expect(onDone).toHaveBeenCalledExactlyOnceWith("hi");
  });

  it("sends the interim guess when a final never landed", () => {
    FakeRecognizer.instances = [];
    const onDone = vi.fn();
    const handle = listen(FakeRecognizer, { onDone });
    FakeRecognizer.instances[0].hear(result("how is it doing", false));
    handle.stop();
    expect(onDone).toHaveBeenCalledExactlyOnceWith("how is it doing");
  });

  it("leaves the browser default lang when none is passed", () => {
    FakeRecognizer.instances = [];
    listen(FakeRecognizer, { onDone: vi.fn() });
    expect(FakeRecognizer.instances[0].lang).toBe("");
  });

  it("abort drops what was heard and reports the error code", () => {
    FakeRecognizer.instances = [];
    const onDone = vi.fn();
    const onError = vi.fn();
    const handle = listen(FakeRecognizer, { onDone, onError });
    const rec = FakeRecognizer.instances[0];
    rec.hear(result("that was the radio"));
    handle.abort();
    expect(rec.abort).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("aborted");
    expect(onDone).toHaveBeenCalledExactlyOnceWith("");
  });

  it("ends with empty words when nothing was heard", () => {
    FakeRecognizer.instances = [];
    const onDone = vi.fn();
    const onError = vi.fn();
    listen(FakeRecognizer, { onDone, onError });
    const rec = FakeRecognizer.instances[0];
    rec.onerror?.({ error: "no-speech" });
    rec.onend?.();
    expect(onError).toHaveBeenCalledWith("no-speech");
    expect(onDone).toHaveBeenCalledExactlyOnceWith("");
  });
});

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSpeak, hushSpeaker, TTS_PATH } from "@/app/lib/tts";
import type { SpeakEvent } from "@/lib/phone/speaker";

type Listener = () => void;

class FakeAudio {
  src = "";
  paused = true;
  listeners = new Map<string, Listener[]>();
  play = vi.fn(async () => {
    this.paused = false;
  });

  pause = vi.fn(() => {
    this.paused = true;
  });

  removeAttribute = vi.fn((name: string) => {
    if (name === "src") {
      this.src = "";
    }
  });

  addEventListener(name: string, fn: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }

  fire(name: string) {
    for (const fn of this.listeners.get(name) ?? []) {
      fn();
    }
  }
}

const audio = () => new FakeAudio() as unknown as HTMLAudioElement;

const createObjectURL = vi.fn(() => "blob:kit/1");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mp3(): Response {
  return new Response(new Uint8Array([0xff, 0xfb]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
}

describe("browserSpeak", () => {
  it("strips markdown, posts the words with cookies, and plays what comes back", async () => {
    const fetchFn = vi.fn(async () => mp3());
    const a = audio();
    const ok = await browserSpeak("**On my way.** See you in `10`. 🚗", { fetch: fetchFn as unknown as typeof fetch, audio: a });
    expect(ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [path, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(TTS_PATH);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ text: "On my way. See you in 10." });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(a.src).toBe("blob:kit/1");
    expect((a as unknown as FakeAudio).play).toHaveBeenCalledOnce();
    (a as unknown as FakeAudio).fire("ended");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:kit/1");
  });

  it("tells the Worker which language to speak when Settings picked one", async () => {
    const fetchFn = vi.fn(async () => mp3());
    await browserSpeak("今夜は**雨**です。", { fetch: fetchFn as unknown as typeof fetch, audio: audio(), lang: "ja" });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: "今夜は雨です。", lang: "ja" });
  });

  it("says nothing for markdown-only or blank replies and never hits the Worker", async () => {
    const fetchFn = vi.fn();
    expect(await browserSpeak("---", { fetch: fetchFn as unknown as typeof fetch, audio: audio() })).toBe(false);
    expect(await browserSpeak("   ", { fetch: fetchFn as unknown as typeof fetch, audio: audio() })).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("stays quiet when the Worker declines or the network fails", async () => {
    const declined = vi.fn(async () => new Response(null, { status: 404 }));
    const a = audio();
    expect(await browserSpeak("hi", { fetch: declined as unknown as typeof fetch, audio: a })).toBe(false);
    expect((a as unknown as FakeAudio).play).not.toHaveBeenCalled();
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await browserSpeak("hi", { fetch: down as unknown as typeof fetch, audio: audio() })).toBe(false);
  });

  it("returns false and releases the URL when the browser refuses to play", async () => {
    const a = new FakeAudio();
    a.play = vi.fn(async () => {
      throw new DOMException("gesture", "NotAllowedError");
    });
    const ok = await browserSpeak("hi", { fetch: (async () => mp3()) as unknown as typeof fetch, audio: a as unknown as HTMLAudioElement });
    expect(ok).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:kit/1");
  });

  it("a second reply replaces the first instead of talking over it", async () => {
    const a = new FakeAudio();
    const fetchFn = (async () => mp3()) as unknown as typeof fetch;
    createObjectURL.mockReturnValueOnce("blob:kit/1").mockReturnValueOnce("blob:kit/2");
    await browserSpeak("first", { fetch: fetchFn, audio: a as unknown as HTMLAudioElement });
    await browserSpeak("second", { fetch: fetchFn, audio: a as unknown as HTMLAudioElement });
    expect(a.pause).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:kit/1");
    expect(a.src).toBe("blob:kit/2");
    a.fire("ended");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:kit/2");
  });

  it("reports fetching, then playing, then done when the clip ends", async () => {
    const phases: SpeakEvent[] = [];
    const a = new FakeAudio();
    const ok = await browserSpeak("hi", {
      fetch: (async () => mp3()) as unknown as typeof fetch,
      audio: a as unknown as HTMLAudioElement,
      onPhase: (ev) => phases.push(ev),
    });
    expect(ok).toBe(true);
    expect(phases).toEqual([{ phase: "fetching" }, { phase: "playing" }]);
    a.fire("ended");
    a.fire("error");
    expect(phases.slice(2)).toEqual([{ phase: "done" }]);
  });

  it("says why it stayed quiet", async () => {
    async function last(fetchFn: () => Promise<Response>): Promise<SpeakEvent | undefined> {
      const phases: SpeakEvent[] = [];
      await browserSpeak("hi", { fetch: fetchFn as unknown as typeof fetch, audio: audio(), onPhase: (ev) => phases.push(ev) });
      return phases.at(-1);
    }
    expect(await last(async () => new Response(null, { status: 404 }))).toEqual({ phase: "failed", reason: "no-voice" });
    expect(await last(async () => new Response(null, { status: 401 }))).toEqual({ phase: "failed", reason: "unauthorized" });
    expect(await last(async () => new Response(null, { status: 429 }))).toEqual({ phase: "failed", reason: "busy" });
    expect(await last(async () => new Response(null, { status: 502 }))).toEqual({ phase: "failed", reason: "vendor" });
    expect(await last(async () => {
      throw new TypeError("offline");
    })).toEqual({ phase: "failed", reason: "offline" });

    const empty: SpeakEvent[] = [];
    await browserSpeak("---", { fetch: vi.fn() as unknown as typeof fetch, audio: audio(), onPhase: (ev) => empty.push(ev) });
    expect(empty).toEqual([{ phase: "failed", reason: "empty" }]);

    const refused = new FakeAudio();
    refused.play = vi.fn(async () => {
      throw new DOMException("gesture", "NotAllowedError");
    });
    const played: SpeakEvent[] = [];
    await browserSpeak("hi", {
      fetch: (async () => mp3()) as unknown as typeof fetch,
      audio: refused as unknown as HTMLAudioElement,
      onPhase: (ev) => played.push(ev),
    });
    expect(played).toEqual([{ phase: "fetching" }, { phase: "failed", reason: "play" }]);
  });
});

describe("hushSpeaker", () => {
  it("is a no-op before anything has played", () => {
    expect(() => hushSpeaker()).not.toThrow();
  });

  it("tells the playing reply it is done, once", async () => {
    const phases: SpeakEvent[] = [];
    const a = new FakeAudio();
    await browserSpeak("hi", {
      fetch: (async () => mp3()) as unknown as typeof fetch,
      audio: a as unknown as HTMLAudioElement,
      onPhase: (ev) => phases.push(ev),
    });
    hushSpeaker();
    expect(phases.at(-1)).toEqual({ phase: "done" });
    hushSpeaker();
    a.fire("ended");
    expect(phases.filter((p) => p.phase === "done")).toHaveLength(1);
  });
});

/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserRecognizer, HoldToTalk } from "@/app/components/chat/HoldToTalk";
import { LISTEN_END_MS, type Recognizer, type RecognizerResult } from "@/lib/phone/speech";

class FakeRecognizer implements Recognizer {
  static last: FakeRecognizer | null = null;
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 3;
  onresult: Recognizer["onresult"] = null;
  onerror: Recognizer["onerror"] = null;
  onend: Recognizer["onend"] = null;
  start = vi.fn();
  /** Real recognizers finish the utterance after stop(); end arrives a beat later. */
  stop = vi.fn();
  abort = vi.fn(() => {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  });

  constructor() {
    FakeRecognizer.last = this;
  }

  hear(transcript: string) {
    const r: RecognizerResult = { isFinal: true, length: 1, 0: { transcript } };
    this.onresult?.({ results: [r] });
  }

  /** The browser fires `end` on its own tick, outside any React event, so flush it like one. */
  end() {
    act(() => this.onend?.());
  }

  refuse() {
    act(() => this.onerror?.({ error: "not-allowed" }));
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "permissions");
  FakeRecognizer.last = null;
});

function hold() {
  const btn = screen.getByRole("button", { name: "Hold to talk" });
  fireEvent.pointerDown(btn, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  return btn;
}

describe("HoldToTalk", () => {
  it("listens while held, commits on release, and hands the words to the owner once", () => {
    const onText = vi.fn();
    render(<HoldToTalk onText={onText} recognizer={FakeRecognizer} />);
    const btn = hold();
    const rec = FakeRecognizer.last!;
    expect(rec.start).toHaveBeenCalledOnce();
    expect(rec.continuous).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.textContent).toBe("Release to send");
    rec.hear("what time is the game");
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(rec.stop).toHaveBeenCalledOnce();
    expect(btn.textContent).toBe("…");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(onText).not.toHaveBeenCalled();
    rec.end();
    expect(onText).toHaveBeenCalledExactlyOnceWith("what time is the game");
    expect(btn.textContent).toBe("Hold to talk");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("unhangs the ellipsis if the recognizer never ends after release", () => {
    vi.useFakeTimers();
    const onText = vi.fn();
    render(<HoldToTalk onText={onText} recognizer={FakeRecognizer} />);
    const btn = hold();
    FakeRecognizer.last!.hear("how is it doing");
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(btn.textContent).toBe("…");
    expect(onText).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(LISTEN_END_MS);
    });
    expect(onText).toHaveBeenCalledExactlyOnceWith("how is it doing");
    expect(btn.textContent).toBe("Hold to talk");
    vi.useRealTimers();
  });

  it("does not send when nothing was heard", () => {
    const onText = vi.fn();
    render(<HoldToTalk onText={onText} recognizer={FakeRecognizer} />);
    const btn = hold();
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 0, clientY: 0 });
    FakeRecognizer.last!.end();
    expect(onText).not.toHaveBeenCalled();
    expect(btn.textContent).toBe("Hold to talk");
  });

  it("slides off to cancel: the words are dropped and never sent", () => {
    const onText = vi.fn();
    render(<HoldToTalk onText={onText} recognizer={FakeRecognizer} />);
    const btn = hold();
    const rec = FakeRecognizer.last!;
    rec.hear("that was the radio");
    fireEvent.pointerMove(btn, { pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(rec.abort).toHaveBeenCalledOnce();
    expect(rec.stop).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(btn.textContent).toBe("Hold to talk");
  });

  it("treats a pointer cancel like a slide-off", () => {
    const onText = vi.fn();
    render(<HoldToTalk onText={onText} recognizer={FakeRecognizer} />);
    const btn = hold();
    FakeRecognizer.last!.hear("half a");
    fireEvent.pointerCancel(btn, { pointerId: 1 });
    expect(FakeRecognizer.last!.abort).toHaveBeenCalledOnce();
    expect(onText).not.toHaveBeenCalled();
  });

  it("shows Mic blocked after a permission refusal and re-arms on the next press", () => {
    render(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} />);
    const btn = hold();
    const rec = FakeRecognizer.last!;
    rec.refuse();
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 0, clientY: 0 });
    rec.end();
    expect(btn.textContent).toBe("Mic blocked");
    fireEvent.pointerDown(btn, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    expect(btn.textContent).toBe("Release to send");
  });

  it("does not treat a query denied as blocked, and clears a real refusal when granted", async () => {
    const status = { state: "denied" as PermissionState, onchange: null as (() => void) | null };
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: vi.fn(async () => status) },
    });
    render(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} />);
    const btn = screen.getByRole("button", { name: "Hold to talk" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(btn.textContent).toBe("Hold to talk");
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    FakeRecognizer.last!.refuse();
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 0, clientY: 0 });
    FakeRecognizer.last!.end();
    expect(btn.textContent).toBe("Mic blocked");
    await act(async () => {
      status.state = "granted";
      status.onchange?.();
    });
    expect(btn.textContent).toBe("Hold to talk");
  });

  it("ignores right-click and does nothing while disabled", () => {
    const { rerender } = render(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} disabled />);
    const btn = screen.getByRole("button", { name: "Hold to talk" });
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1 });
    expect(FakeRecognizer.last).toBeNull();
    rerender(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} />);
    fireEvent.pointerDown(btn, { button: 2, pointerId: 1 });
    expect(FakeRecognizer.last).toBeNull();
  });

  it("works from the keyboard: space down listens, space up sends", () => {
    const onText = vi.fn();
    render(<HoldToTalk onText={onText} recognizer={FakeRecognizer} />);
    const btn = screen.getByRole("button", { name: "Hold to talk" });
    fireEvent.keyDown(btn, { key: " " });
    const rec = FakeRecognizer.last!;
    expect(rec.start).toHaveBeenCalledOnce();
    fireEvent.keyDown(btn, { key: " ", repeat: true });
    expect(rec.start).toHaveBeenCalledOnce();
    rec.hear("ok");
    fireEvent.keyUp(btn, { key: " " });
    expect(rec.stop).toHaveBeenCalledOnce();
    rec.end();
    expect(onText).toHaveBeenCalledWith("ok");
  });

  it("aborts a live hold on unmount", () => {
    const { unmount } = render(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} />);
    hold();
    unmount();
    expect(FakeRecognizer.last!.abort).toHaveBeenCalledOnce();
  });

  it("says Kit is talking while idle, and a press still listens", () => {
    const { rerender } = render(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} speaking="fetching" />);
    const btn = screen.getByRole("button", { name: "Hold to talk" });
    expect(btn.textContent).toBe("Fetching voice…");
    rerender(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} speaking="playing" />);
    expect(btn.textContent).toBe("Speaking · hold to cut in");
    expect(btn.className).toContain("border-ok");
    fireEvent.pointerDown(btn, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    expect(btn.textContent).toBe("Release to send");
    rerender(<HoldToTalk onText={vi.fn()} recognizer={FakeRecognizer} speaking="idle" />);
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 0, clientY: 0 });
    FakeRecognizer.last!.end();
    expect(btn.textContent).toBe("Hold to talk");
  });

  it("marks the recognizer blocked when start throws", () => {
    class Throws extends FakeRecognizer {
      start = vi.fn(() => {
        throw new Error("InvalidStateError");
      });
    }
    render(<HoldToTalk onText={vi.fn()} recognizer={Throws} />);
    const btn = hold();
    expect(btn.textContent).toBe("Mic blocked");
  });
});

describe("browserRecognizer", () => {
  it("finds the window constructor, prefixed or not, and is null without one", () => {
    expect(browserRecognizer()).toBeNull();
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognizer);
    expect(browserRecognizer()).toBe(FakeRecognizer);
    vi.stubGlobal("SpeechRecognition", class {});
    expect(browserRecognizer()).not.toBe(FakeRecognizer);
  });
});

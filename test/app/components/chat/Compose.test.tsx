/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Compose } from "@/app/components/chat/Compose";

function pasteBits(file: File) {
  return {
    items: [{ kind: "file", type: file.type, getAsFile: () => file }],
    files: [file],
    types: ["Files"],
    getData: () => "",
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeRecognizer.last = null;
});

class FakeRecognizer {
  static last: FakeRecognizer | null = null;
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 3;
  onresult: ((ev: { results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>> }) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognizer.last = this;
  }
}

describe("Compose", () => {
  it("sends trimmed text and ignores blanks", () => {
    const onSend = vi.fn();
    render(<Compose onSend={onSend} gpsHint="GPS on send" />);
    expect(screen.getByPlaceholderText("Message")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Message"), { target: { value: "  hi  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("opens the photo picker when asked", () => {
    const onPhoto = vi.fn();
    render(<Compose onSend={vi.fn()} onPhoto={onPhoto} />);
    const gallery = document.querySelector("input[type=file]:not([capture])") as HTMLInputElement;
    const click = vi.spyOn(gallery, "click");
    fireEvent.click(screen.getByRole("button", { name: "attach" }));
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    expect(click).toHaveBeenCalled();
    expect(gallery.hasAttribute("capture")).toBe(false);
    const file = new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(gallery, { target: { files: [file] } });
    expect(onPhoto).toHaveBeenCalledWith(file);
  });

  it("opens the rear camera from the same menu and sends the shot down the photo path", () => {
    const onPhoto = vi.fn();
    render(<Compose onSend={vi.fn()} onPhoto={onPhoto} />);
    const camera = document.querySelector("input[type=file][capture]") as HTMLInputElement;
    expect(camera.getAttribute("capture")).toBe("environment");
    expect(camera.getAttribute("accept")).toBe("image/*");
    const click = vi.spyOn(camera, "click");
    fireEvent.click(screen.getByRole("button", { name: "attach" }));
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(click).toHaveBeenCalled();
    const shot = new File([new Uint8Array([1])], "shot.jpg", { type: "image/jpeg" });
    fireEvent.change(camera, { target: { files: [shot] } });
    expect(onPhoto).toHaveBeenCalledWith(shot);
  });

  it("shows the staged photo, lets Send go with no caption, and clears it on Remove", () => {
    const onSend = vi.fn();
    const onPhotoClear = vi.fn();
    const url = "data:image/jpeg;base64,/9j/";
    const { rerender } = render(<Compose onSend={onSend} onPhoto={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.queryByAltText("Photo to send")).toBeNull();
    rerender(<Compose onSend={onSend} onPhoto={vi.fn()} photo={url} onPhotoClear={onPhotoClear} />);
    expect((screen.getByAltText("Photo to send") as HTMLImageElement).src).toBe(url);
    expect(send.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onPhotoClear).toHaveBeenCalledTimes(1);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith("");
  });

  it("sends the caption as text; the owner attaches the staged photo to the same turn", () => {
    const onSend = vi.fn();
    render(<Compose onSend={onSend} onPhoto={vi.fn()} photo="data:image/jpeg;base64,/9j/" />);
    fireEvent.change(screen.getByPlaceholderText("Message"), { target: { value: " this hatch? " } });
    fireEvent.keyDown(screen.getByPlaceholderText("Message"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("this hatch?");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("offers neither camera nor photo without onPhoto", () => {
    render(<Compose onSend={vi.fn()} onGpsToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "attach" }));
    expect(screen.queryByRole("button", { name: "Camera" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Photo" })).toBeNull();
    expect(document.querySelector("input[type=file]")).toBeNull();
  });

  it("sends a pasted image through onPhoto", () => {
    const onPhoto = vi.fn();
    const file = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
    render(<Compose onSend={vi.fn()} onPhoto={onPhoto} />);
    fireEvent.paste(screen.getByPlaceholderText("Message"), { clipboardData: pasteBits(file) });
    expect(onPhoto).toHaveBeenCalledWith(file);
    onPhoto.mockClear();
    fireEvent.paste(document, { clipboardData: pasteBits(file) });
    expect(onPhoto).toHaveBeenCalledWith(file);
  });

  it("does not steal image paste from another field, or when compose is disabled", () => {
    const onPhoto = vi.fn();
    const file = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
    const { rerender } = render(
      <div>
        <input aria-label="other" />
        <Compose onSend={vi.fn()} onPhoto={onPhoto} />
      </div>,
    );
    fireEvent.paste(screen.getByLabelText("other"), { clipboardData: pasteBits(file) });
    expect(onPhoto).not.toHaveBeenCalled();
    rerender(
      <div>
        <input aria-label="other" />
        <Compose onSend={vi.fn()} onPhoto={onPhoto} disabled />
      </div>,
    );
    fireEvent.paste(document, { clipboardData: pasteBits(file) });
    expect(onPhoto).not.toHaveBeenCalled();
  });

  it("lists harness commands from a supplied catalog", () => {
    const onSend = vi.fn();
    const catalog = [
      { name: "new", hint: "reset this session" },
      { name: "tools", hint: "prefixed tool catalog" },
      { name: "tokens", hint: "prompt token breakdown" },
      { name: "toolstats", hint: "per-tool call ledger" },
    ];
    render(<Compose onSend={onSend} commands catalog={catalog} placeholder="Message Kit" />);
    expect(screen.queryByRole("listbox", { name: "Harness commands" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "attach" }));
    fireEvent.click(screen.getByRole("button", { name: "harness commands" }));
    expect(screen.getByText("These go to the agent, not the chat model.")).toBeTruthy();
    expect(screen.getByRole("option", { name: /^\/new / })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Message Kit"), { target: { value: "/to" } });
    expect(screen.getByRole("option", { name: /^\/tools / })).toBeTruthy();
    expect(screen.getByRole("option", { name: /^\/tokens / })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^\/new / })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^\/tools / }));
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText("Message Kit") as HTMLTextAreaElement).value).toBe("/tools");
    expect(screen.queryByRole("listbox", { name: "Harness commands" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("/tools");
  });

  it("Enter selects the command and closes the picker; the next Enter sends", () => {
    const onSend = vi.fn();
    const catalog = [
      { name: "tools", hint: "prefixed tool catalog" },
      { name: "toolstats", hint: "per-tool call ledger" },
      { name: "brief", hint: "hold a prefix ~6h", args: true },
    ];
    render(<Compose onSend={onSend} commands catalog={catalog} initialText="/tools" placeholder="Message Kit" />);
    const box = screen.getByPlaceholderText("Message Kit");
    expect(screen.getByRole("option", { name: /^\/tools / }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("/tools");
    expect(screen.queryByRole("listbox", { name: "Harness commands" })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledExactlyOnceWith("/tools");

    onSend.mockClear();
    fireEvent.change(box, { target: { value: "/to" } });
    expect(screen.getByRole("listbox", { name: "Harness commands" })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("/tools");
    expect(screen.queryByRole("listbox", { name: "Harness commands" })).toBeNull();

    fireEvent.change(box, { target: { value: "/tool" } });
    fireEvent.change(box, { target: { value: "/tools" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("/toolstats");
    expect(screen.queryByRole("listbox", { name: "Harness commands" })).toBeNull();

    fireEvent.change(box, { target: { value: "/brief" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("/brief ");
    expect(screen.queryByRole("listbox", { name: "Harness commands" })).toBeNull();
  });

  it("inserts a trailing space for arg commands and Enter picks the highlight", () => {
    const onSend = vi.fn();
    const catalog = [
      { name: "new", hint: "reset this session" },
      { name: "cancel", hint: "stop the in-flight turn" },
      { name: "brief", hint: "hold a prefix ~6h", args: true },
    ];
    render(<Compose onSend={onSend} commands catalog={catalog} initialText="/" placeholder="Message Kit" />);
    const box = screen.getByPlaceholderText("Message Kit");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect((box as HTMLTextAreaElement).value).toBe("/cancel");
    fireEvent.change(box, { target: { value: "/brief" } });
    fireEvent.click(screen.getByRole("option", { name: /^\/brief / }));
    expect((box as HTMLTextAreaElement).value).toBe("/brief ");
  });

  it("toggles GPS and pins from the attach menu", () => {
    const onPin = vi.fn();
    const onGpsToggle = vi.fn();
    const { rerender } = render(
      <Compose onSend={vi.fn()} onPin={onPin} gpsOn onGpsToggle={onGpsToggle} gpsHint="GPS on send" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "attach" }));
    expect(screen.getByRole("dialog", { name: "Attach" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "GPS on" }));
    expect(onGpsToggle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "drop pin" }));
    expect(onPin).toHaveBeenCalledOnce();
    rerender(
      <Compose onSend={vi.fn()} onPin={onPin} gpsOn={false} onGpsToggle={onGpsToggle} gpsHint="GPS off" />,
    );
    expect((screen.getByRole("button", { name: "drop pin" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warms GPS when the composer is focused", () => {
    const onEngage = vi.fn();
    render(<Compose onSend={vi.fn()} onEngage={onEngage} />);
    fireEvent.focus(screen.getByPlaceholderText("Message"));
    expect(onEngage).toHaveBeenCalledOnce();
  });

  it("inserts from the emoji picker and converts colon codes", () => {
    const onSend = vi.fn();
    render(<Compose onSend={onSend} />);
    const box = screen.getByPlaceholderText("Message");
    fireEvent.click(screen.getByRole("button", { name: "emoji" }));
    expect(screen.getByRole("dialog", { name: "Emoji" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ":shrug:" }));
    expect((box as HTMLTextAreaElement).value).toBe("🤷");

    fireEvent.change(box, { target: { value: "ok :fire:" } });
    expect((box as HTMLTextAreaElement).value).toBe("ok 🔥");

    fireEvent.change(box, { target: { value: "yo :D" } });
    expect((box as HTMLTextAreaElement).value).toBe("yo :D");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("yo 😀");
  });

  it("opens the emoji picker when the sample asks", () => {
    render(<Compose onSend={vi.fn()} initialEmoji />);
    expect(screen.getByRole("dialog", { name: "Emoji" })).toBeTruthy();
    expect(screen.getByLabelText("Search emoji")).toBeTruthy();
  });

  it("types by default: no mic in the row even when Web Speech exists and voice is wired", () => {
    render(<Compose onSend={vi.fn()} onVoice={vi.fn()} recognizer={FakeRecognizer} onPhoto={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Hold to talk" })).toBeNull();
    expect(screen.getByPlaceholderText("Message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "emoji" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "attach" })).toBeTruthy();
  });

  it("voice on swaps the whole row for one wide hold-to-talk bar and auto-sends the words", () => {
    const onSend = vi.fn();
    const onVoice = vi.fn();
    const { rerender } = render(
      <Compose onSend={onSend} onVoice={onVoice} onPhoto={vi.fn()} voice recognizer={FakeRecognizer} />,
    );
    const hold = screen.getByRole("button", { name: "Hold to talk" });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByPlaceholderText("Message")).toBeNull();
    expect(screen.queryByRole("button", { name: "emoji" })).toBeNull();
    expect(screen.queryByRole("button", { name: "attach" })).toBeNull();
    expect(hold.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "min-h-11", "touch-none", "select-none"]));

    fireEvent.pointerDown(hold, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    const rec = FakeRecognizer.last!;
    rec.onresult?.({ results: [{ isFinal: true, length: 1, 0: { transcript: "on my way" } }] });
    fireEvent.pointerUp(hold, { pointerId: 1, clientX: 0, clientY: 0 });
    rec.onend?.();
    expect(onVoice).toHaveBeenCalledExactlyOnceWith("on my way");
    expect(onSend).not.toHaveBeenCalled();

    rerender(<Compose onSend={onSend} onVoice={onVoice} onPhoto={vi.fn()} voice={false} recognizer={FakeRecognizer} />);
    expect(screen.queryByRole("button", { name: "Hold to talk" })).toBeNull();
    expect(screen.getByPlaceholderText("Message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("hands Settings → Language to the recognizer so a hold is heard in that tongue", () => {
    render(<Compose onSend={vi.fn()} onVoice={vi.fn()} voice recognizer={FakeRecognizer} lang="ja-JP" />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Hold to talk" }), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    expect(FakeRecognizer.last?.lang).toBe("ja-JP");
  });

  it("keeps the typed row when voice is on but the browser has no Web Speech", () => {
    render(<Compose onSend={vi.fn()} onVoice={vi.fn()} voice recognizer={null} />);
    expect(screen.queryByRole("button", { name: "Hold to talk" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("keeps a staged photo chip above the hold bar so it rides along with the words", () => {
    render(
      <Compose
        onSend={vi.fn()}
        onVoice={vi.fn()}
        onPhoto={vi.fn()}
        onPhotoClear={vi.fn()}
        photo="data:image/jpeg;base64,/9j/"
        voice
        recognizer={FakeRecognizer}
      />,
    );
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("disables the hold bar with the rest of compose while the socket is down", () => {
    render(<Compose onSend={vi.fn()} onVoice={vi.fn()} voice recognizer={FakeRecognizer} disabled />);
    const hold = screen.getByRole("button", { name: "Hold to talk" }) as HTMLButtonElement;
    expect(hold.disabled).toBe(true);
    fireEvent.pointerDown(hold, { button: 0, pointerId: 1 });
    expect(FakeRecognizer.last).toBeNull();
  });

  it("stacks emoji and attach on the left of the draft", () => {
    render(<Compose onSend={vi.fn()} onPhoto={vi.fn()} />);
    const emoji = screen.getByRole("button", { name: "emoji" });
    const attach = screen.getByRole("button", { name: "attach" });
    const box = screen.getByPlaceholderText("Message");
    const send = screen.getByRole("button", { name: "Send" });
    expect(emoji.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attach.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rail = emoji.parentElement;
    expect(rail?.contains(attach)).toBe(true);
    expect(rail?.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col"]));
    expect(send.className.split(/\s+/)).toEqual(expect.arrayContaining(["self-stretch"]));
  });
});

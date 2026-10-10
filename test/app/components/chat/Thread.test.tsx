/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bubbleFrom, canReact, REACT_HOLD_MS, Thread } from "@/app/components/chat/Thread";
import { REACTION_PALETTE } from "@/lib/chat/react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Thread", () => {
  it("shows an empty mouth and then bubbles", () => {
    const { rerender } = render(<Thread messages={[]} />);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    rerender(
      <Thread
        messages={[
          { id: "1", from: "you", text: "hi", at: 1 },
          { id: "2", from: "kit", text: "yo", kind: "push", at: 2, photo: "data:image/jpeg;base64,aa" },
        ]}
      />,
    );
    expect(screen.getByText("hi")).toBeTruthy();
    expect(screen.getByText("yo")).toBeTruthy();
    expect(screen.getByText("ping")).toBeTruthy();
    expect(screen.getByText("hi").closest(".text-chat")).toBeTruthy();
  });

  it("marks your pending bubble as sending", () => {
    render(
      <Thread
        messages={[{ id: "1", from: "you", text: "hi", at: 1, pending: true }]}
      />,
    );
    expect(screen.getByText("hi")).toBeTruthy();
    expect(screen.getByText("sending")).toBeTruthy();
  });

  it("does not mark kit bubbles as sending", () => {
    render(
      <Thread
        messages={[{ id: "2", from: "kit", text: "yo", at: 2, pending: true }]}
      />,
    );
    expect(screen.getByText("yo")).toBeTruthy();
    expect(screen.queryByText("sending")).toBeNull();
  });

  it("paints kit markdown instead of the source marks", () => {
    render(
      <Thread
        messages={[{ id: "2", from: "kit", text: "Try **this** path", at: 2 }]}
      />,
    );
    expect(screen.getByText("this").tagName).toBe("STRONG");
    expect(screen.queryByText("Try **this** path")).toBeNull();
  });

  it("treats flushed inbound as your bubble on the phone", () => {
    expect(bubbleFrom(true, "inbound")).toBe("you");
    expect(bubbleFrom(true, "reply")).toBe("kit");
    expect(bubbleFrom(true, "push")).toBe("kit");
    expect(bubbleFrom(true, "draft")).toBe("kit");
    expect(bubbleFrom(false, "inbound")).toBe("you");
    expect(bubbleFrom(false, "reply")).toBe("you");
  });

  it("paints a draft bubble in italics", () => {
    render(
      <Thread
        messages={[{ id: "d", from: "kit", text: "⏳ spinning up", kind: "draft", at: 1 }]}
      />,
    );
    const body = screen.getByText("⏳ spinning up");
    expect(body.closest(".italic")).toBeTruthy();
  });

  it("keeps the same DOM node when a live draft becomes a reply", () => {
    const { rerender } = render(
      <Thread
        messages={[{ id: "__draft__", from: "kit", text: "Hello", kind: "draft", at: 1, live: true }]}
      />,
    );
    const node = screen.getByText("Hello").closest("li");
    rerender(
      <Thread
        messages={[{ id: "r1", from: "kit", text: "Hello", kind: "reply", at: 1, live: true }]}
      />,
    );
    expect(screen.getByText("Hello").closest("li")).toBe(node);
    expect(screen.getByText("Hello").closest(".italic")).toBeNull();
  });
});

describe("Thread reactions", () => {
  it("paints the chip on either side and knows which bubbles take one", () => {
    render(
      <Thread
        messages={[
          { id: "m1", from: "you", text: "thanks!", at: 1, kind: "inbound", reaction: "👍" },
          { id: "r1", from: "kit", text: "Rain at 6.", at: 2, kind: "reply", reaction: "❤️" },
        ]}
      />,
    );
    expect(screen.getByLabelText("reaction 👍").tagName).toBe("SPAN");
    expect(screen.getByLabelText("reaction ❤️").tagName).toBe("SPAN"); // no onReact: not a button
    expect(canReact({ id: "r1", from: "kit", kind: "reply" })).toBe(true);
    expect(canReact({ id: "p1", from: "kit", kind: "push" })).toBe(true);
    expect(canReact({ id: "d", from: "kit", kind: "draft" })).toBe(false);
    expect(canReact({ id: "m1", from: "you", kind: "inbound" })).toBe(false);
  });

  it("right-click opens the palette on a Kit bubble; a pick sends and closes", () => {
    const onReact = vi.fn();
    render(
      <Thread
        onReact={onReact}
        messages={[
          { id: "m1", from: "you", text: "thanks!", at: 1, kind: "inbound" },
          { id: "r1", from: "kit", text: "Rain at 6.", at: 2, kind: "reply" },
        ]}
      />,
    );
    expect(screen.queryByRole("group", { name: "React" })).toBeNull();
    fireEvent.contextMenu(screen.getByText("thanks!"));
    expect(screen.queryByRole("group", { name: "React" })).toBeNull(); // your own bubble: no picker
    fireEvent.contextMenu(screen.getByText("Rain at 6."));
    const picker = screen.getByRole("group", { name: "React" });
    expect(picker.querySelectorAll("button")).toHaveLength(REACTION_PALETTE.length);
    fireEvent.click(screen.getByRole("button", { name: "React 👍" }));
    expect(onReact).toHaveBeenCalledWith("r1", "👍");
    expect(screen.queryByRole("group", { name: "React" })).toBeNull();
  });

  it("long-press opens it; a drag or an early lift does not", () => {
    vi.useFakeTimers();
    const onReact = vi.fn();
    render(
      <Thread
        onReact={onReact}
        messages={[{ id: "r1", from: "kit", text: "Rain at 6.", at: 2, kind: "reply" }]}
      />,
    );
    const bubble = screen.getByText("Rain at 6.");
    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(bubble);
    act(() => {
      vi.advanceTimersByTime(REACT_HOLD_MS + 50);
    });
    expect(screen.queryByRole("group", { name: "React" })).toBeNull();

    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubble, { clientX: 40, clientY: 10 }); // scrolling, not holding
    act(() => {
      vi.advanceTimersByTime(REACT_HOLD_MS + 50);
    });
    expect(screen.queryByRole("group", { name: "React" })).toBeNull();

    fireEvent.pointerDown(bubble, { clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(REACT_HOLD_MS + 50);
    });
    expect(screen.getByRole("group", { name: "React" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "React" })).toBeNull();
  });

  it("picking the emoji already set clears it; tapping the chip reopens the palette", () => {
    const onReact = vi.fn();
    render(
      <Thread
        onReact={onReact}
        messages={[{ id: "r1", from: "kit", text: "Rain at 6.", at: 2, kind: "reply", reaction: "👍" }]}
      />,
    );
    const chip = screen.getByRole("button", { name: "reaction 👍" });
    fireEvent.click(chip);
    expect(screen.getByRole("button", { name: "React 👍" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "React 👍" }));
    expect(onReact).toHaveBeenCalledWith("r1", "");
  });
});

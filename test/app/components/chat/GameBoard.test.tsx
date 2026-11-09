/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameStorageKey, GameSheet } from "@/app/components/chat/GameBoard";
import { ghostResult, ghostSeed } from "@/lib/chat/ghost";
import { hangmanAskGraph, hangmanAskWord, hangmanResult } from "@/lib/chat/hangman";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(gameStorageKey("kit"));
  window.localStorage.removeItem(gameStorageKey("other"));
});

describe("GameSheet", () => {
  it("picker shows Ghost and Hangman; who-starts defaults to You", () => {
    render(<GameSheet agentName="Kit" roomKey="kit" onClose={() => {}} />);
    expect(screen.getByText("Play Kit.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ghost" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hangman" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "You" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Kit" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Kit" }));
    expect(screen.getByRole("button", { name: "Kit" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saved local board in localStorage still shows the picker", () => {
    window.localStorage.setItem(
      gameStorageKey("kit"),
      JSON.stringify({
        kind: "four",
        cells: Array.from({ length: 49 }, () => null),
        turn: "human",
      }),
    );
    render(<GameSheet agentName="Kit" roomKey="kit" onClose={() => {}} />);
    expect(screen.getByText("Play Kit.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "4 in a row board" })).toBeNull();
  });

  it("junk in localStorage shows the picker", () => {
    window.localStorage.setItem(gameStorageKey("kit"), '{"kind":"chess","cells":[],"turn":"human"}');
    render(<GameSheet agentName="Kit" roomKey="kit" onClose={() => {}} />);
    expect(screen.getByText("Play Kit.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Tic-tac-toe board" })).toBeNull();
  });

  it("Escape and the scrim call onClose", () => {
    const onEscape = vi.fn();
    const { unmount: unmountEscape } = render(<GameSheet agentName="Kit" roomKey="kit" onClose={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    unmountEscape();

    const onScrim = vi.fn();
    render(<GameSheet agentName="Kit" roomKey="kit" onClose={onScrim} />);
    fireEvent.click(screen.getByTestId("game-scrim"));
    expect(onScrim).toHaveBeenCalledTimes(1);
  });

  it("switching roomKey shows picker for each room", () => {
    const { rerender } = render(<GameSheet agentName="Kit" roomKey="kit" onClose={() => {}} />);
    expect(screen.getByText("Play Kit.")).toBeTruthy();

    rerender(<GameSheet agentName="Kit" roomKey="other" onClose={() => {}} />);
    expect(screen.getByText("Play Kit.")).toBeTruthy();

    rerender(<GameSheet agentName="Kit" roomKey="kit" onClose={() => {}} />);
    expect(screen.getByText("Play Kit.")).toBeTruthy();
  });

  it("picker lists Ghost then Hangman; With the agent on both", () => {
    render(<GameSheet agentName="Kit" roomKey="kit" onClose={() => {}} />);
    const order = ["Ghost", "Hangman"].map((name) => screen.getByRole("button", { name }));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("With the agent")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Tic-tac-toe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect 4" })).toBeNull();
    expect(screen.queryByRole("button", { name: "4 in a row" })).toBeNull();
  });

  it("closing the drawer hides UI but keeps hangman state until reopened", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} open />);
    fireEvent.click(screen.getByRole("button", { name: "Kit" }));
    fireEvent.click(screen.getByRole("button", { name: "Hangman" }));
    expect(screen.getByText("Waiting for Kit")).toBeTruthy();

    rerender(<GameSheet {...props} open={false} />);
    expect(screen.queryByRole("dialog", { name: "Game" })).toBeNull();

    rerender(<GameSheet {...props} open={false} agentReply='{"word":"quartz"}' />);
    expect(screen.queryByRole("dialog", { name: "Game" })).toBeNull();

    rerender(<GameSheet {...props} open agentReply='{"word":"quartz"}' />);
    expect(screen.getByLabelText("Pattern").textContent).toBe("_ _ _ _ _ _");
    expect(screen.queryByText("Waiting for Kit")).toBeNull();
  });

  it("Kit's word: ask word, parse reply, local guess does not re-send", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kit" }));
    fireEvent.click(screen.getByRole("button", { name: "Hangman" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(hangmanAskWord("Kit"));

    rerender(<GameSheet {...props} agentReply='{"word":"quartz"}' />);
    expect(screen.getByLabelText("Pattern").textContent).toBe("_ _ _ _ _ _");

    fireEvent.change(screen.getByLabelText("Your guess"), { target: { value: "Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Guess" }));
    expect(screen.getByLabelText("Pattern").textContent).toContain("Z");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("Kit's word: winning guess sends hangmanResult to Kit", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kit" }));
    fireEvent.click(screen.getByRole("button", { name: "Hangman" }));
    rerender(<GameSheet {...props} agentReply='{"word":"aaaa"}' />);
    fireEvent.change(screen.getByLabelText("Your guess"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Guess" }));
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[0]?.[0]).toBe(hangmanAskWord("Kit"));
    expect(onSend.mock.calls[1]?.[0]).toBe(
      hangmanResult("Kit", { secret: "AAAA", guessed: ["A"], lives: 6 }, "you"),
    );
  });

  it("Your word: Kit's winning graph sends hangmanResult not another ask", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Hangman" }));
    fireEvent.change(screen.getByLabelText("Your word"), { target: { value: "aaaa" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide word" }));
    rerender(<GameSheet {...props} agentReply='{"guess":"A"}' />);
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[1]?.[0]).toBe(
      hangmanResult("Kit", { secret: "AAAA", guessed: ["A"], lives: 6 }, "agent"),
    );
    expect(onSend.mock.calls[1]?.[0]).not.toContain("Reply with one JSON");
  });

  it("Your word: hide word, walk graph, follow-up ask with misses and lives", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Hangman" }));
    fireEvent.change(screen.getByLabelText("Your word"), { target: { value: "quartz" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide word" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(hangmanAskGraph("Kit", { secret: "QUARTZ", guessed: [], lives: 6 }));

    rerender(<GameSheet {...props} agentReply='{"guess":"E","miss":{"guess":"A"}}' />);
    expect(screen.getByLabelText("Guesses").textContent).toContain("E miss");
    expect(screen.getByLabelText("Guesses").textContent).toContain("A hit");
    expect(screen.getByLabelText("Pattern").textContent).toBe("_ _ A _ _ _");
    expect(document.body.textContent).not.toContain("QUARTZ");
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[1]?.[0]).toContain("Misses: E");
    expect(onSend.mock.calls[1]?.[0]).toContain("5 wrong guesses left");

    rerender(<GameSheet {...props} agentReply='{"guess":"U","hit":{"guess":"Z"}}' />);
    expect(screen.getByLabelText("Pattern").textContent).toContain("U");
    expect(screen.getByLabelText("Pattern").textContent).toContain("Z");
    expect(document.body.textContent).not.toContain("QUARTZ");
  });

  it("Ghost: word on graph sends ghostResult without another seed ask", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Ghost" }));
    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: "Play letter" }));
    expect(onSend).toHaveBeenCalledTimes(1);

    rerender(<GameSheet {...props} agentReply={"{\"letter\":\"U\",\"then\":{\"A\":{\"word\":\"QUA\"}}}"} />);
    expect(screen.getByLabelText("Stem").textContent).toBe("QU");

    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Play letter" }));
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[1]?.[0]).toBe(
      ghostResult("Kit", "QUA", "Q(you) U(Kit) A(you)", "Kit says that's a word: QUA."),
    );
    expect(onSend.mock.calls[1]?.[0]).not.toContain("Reply with one JSON");
  });

  it("Ghost: graph letters play locally until a branch miss re-seeds", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Ghost" }));
    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: "Play letter" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(ghostSeed("Kit", "Q", "I add Q. "));

    rerender(<GameSheet {...props} agentReply={"{\"letter\":\"U\",\"then\":{\"A\":{\"letter\":\"R\"}}}"} />);
    expect(screen.getByLabelText("Stem").textContent).toContain("QU");
    expect(screen.getByText("Your turn")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Play letter" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Stem").textContent).toContain("QUAR");

    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Play letter" }));
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[1]?.[0]).toContain("Z(you)");
    expect(onSend.mock.calls[1]?.[0]).toContain("Stem is QUARZ");
    expect(screen.getByText("Waiting for Kit")).toBeTruthy();
  });

  it("Ghost: prose reply while waiting returns to play with status text", () => {
    const onSend = vi.fn();
    const props = {
      agentName: "Kit",
      roomKey: "kit",
      onClose: () => {},
      onSend,
      agentReply: "",
    };
    const { rerender } = render(<GameSheet {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Ghost" }));
    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: "Play letter" }));
    expect(screen.getByText("Waiting for Kit")).toBeTruthy();

    rerender(<GameSheet {...props} agentReply="I need a moment to think." />);
    expect(screen.getByText("I need a moment to think.")).toBeTruthy();
    expect(screen.queryByText("Waiting for Kit")).toBeNull();
    expect(screen.getByLabelText("Stem").textContent).toContain("Q");
    fireEvent.change(screen.getByLabelText("Your letter"), { target: { value: "U" } });
    expect(screen.getByRole("button", { name: "Play letter" }).hasAttribute("disabled")).toBe(false);
  });
});

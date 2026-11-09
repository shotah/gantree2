import { describe, expect, it } from "vitest";
import {
  applyGuess,
  emptyBoard,
  hangmanResult,
  lost,
  parseHangmanGraph,
  parseHangmanWord,
  pattern,
  redactHangmanSecret,
  walkGraph,
} from "@/lib/chat/hangman";

describe("applyGuess", () => {
  it("hit reveals every copy of the letter and does not cost a life", () => {
    const board = emptyBoard("BANANA");
    const { board: next, hit, repeat } = applyGuess(board, "A");
    expect(hit).toBe(true);
    expect(repeat).toBe(false);
    expect(next.lives).toBe(6);
    expect(pattern(next)).toBe("_ A _ A _ A");
  });

  it("miss costs one life", () => {
    const board = emptyBoard("QUARTZ");
    const { board: next, hit } = applyGuess(board, "E");
    expect(hit).toBe(false);
    expect(next.lives).toBe(5);
  });

  it("repeat does not cost a life or change the pattern", () => {
    const board = applyGuess(emptyBoard("QUARTZ"), "E").board;
    const { board: next, hit, repeat } = applyGuess(board, "E");
    expect(repeat).toBe(true);
    expect(hit).toBe(false);
    expect(next.lives).toBe(5);
    expect(pattern(next)).toBe("_ _ _ _ _ _");
  });
});

describe("walkGraph", () => {
  it("on secret QUARTZ and E miss then A hit, lives 5, and stops", () => {
    const graph = parseHangmanGraph('{"guess":"E","miss":{"guess":"A"}}');
    expect(graph).not.toBeNull();
    if (!graph) {
      return;
    }
    const { board, steps } = walkGraph(emptyBoard("QUARTZ"), graph);
    expect(steps).toEqual([{ letter: "E", hit: false }, { letter: "A", hit: true }]);
    expect(board.lives).toBe(5);
    expect(pattern(board)).toBe("_ _ A _ _ _");
  });

  it("on secret QUARTZ and U hit then E miss on hit branch, lives 5", () => {
    const graph = parseHangmanGraph('{"guess":"U","hit":{"guess":"E"}}');
    expect(graph).not.toBeNull();
    if (!graph) {
      return;
    }
    const { board, steps } = walkGraph(emptyBoard("QUARTZ"), graph);
    expect(steps).toEqual([{ letter: "U", hit: true }, { letter: "E", hit: false }]);
    expect(board.lives).toBe(5);
    expect(pattern(board)).toBe("_ U _ _ _ _");
  });

  it("follows hit when the letter is in the word", () => {
    const graph = parseHangmanGraph('{"guess":"Q","hit":{"guess":"U"}}');
    expect(graph).not.toBeNull();
    if (!graph) {
      return;
    }
    const { steps } = walkGraph(emptyBoard("QUARTZ"), graph);
    expect(steps).toEqual([{ letter: "Q", hit: true }, { letter: "U", hit: true }]);
  });

  it("a repeated guess inside the graph stops the walk", () => {
    const board = applyGuess(emptyBoard("QUARTZ"), "E").board;
    const graph = parseHangmanGraph('{"guess":"E","miss":{"guess":"A"}}');
    expect(graph).not.toBeNull();
    if (!graph) {
      return;
    }
    const { steps, board: next } = walkGraph(board, graph);
    expect(steps).toHaveLength(0);
    expect(next.lives).toBe(5);
  });
});

describe("parseHangmanWord", () => {
  it("accepts fenced JSON and rejects cat", () => {
    const text = "```json\n{\"word\":\"quartz\"}\n```";
    expect(parseHangmanWord(text)).toBe("QUARTZ");
    expect(parseHangmanWord('{"word":"cat"}')).toBeNull();
  });
});

describe("hangmanResult", () => {
  it("reports human win after guessing Kit's word", () => {
    const board = applyGuess(emptyBoard("AAAA"), "A").board;
    expect(hangmanResult("Kit", board, "you")).toBe(
      "Kit, Hangman. I got it. Word was AAAA. Pattern is A A A A. Guesses: A. Misses: none. 6 wrong guesses left.",
    );
  });

  it("reports human win when Kit runs out of lives", () => {
    let board: ReturnType<typeof emptyBoard> = emptyBoard("ABCD");
    for (const letter of ["E", "F", "G", "H", "I", "J"]) {
      board = applyGuess(board, letter).board as ReturnType<typeof emptyBoard>;
    }
    expect(lost(board)).toBe(true);
    expect(hangmanResult("Kit", board, "agent")).toContain("You lost.");
    expect(hangmanResult("Kit", board, "agent")).toContain("Word was ABCD.");
  });
});

describe("redactHangmanSecret", () => {
  it("turns a word reply into Picked a secret word. and leaves a guess graph unchanged", () => {
    expect(redactHangmanSecret('{"word":"quartz"}')).toBe("Picked a secret word.");
    const graph = '{"guess":"E","miss":{"guess":"A"}}';
    expect(redactHangmanSecret(graph)).toBe(graph);
  });
});

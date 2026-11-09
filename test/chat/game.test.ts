import { describe, expect, it } from "vitest";
import {
  agentMove,
  cols,
  newGame,
  play,
  rows,
  status,
  winningLine,
  type GameState,
} from "@/lib/chat/game";

function tttPlay(state: GameState, at: number): GameState {
  const next = play(state, at);
  expect(next).not.toBeNull();
  if (next === null) throw new Error("expected legal tic-tac-toe move");
  return next;
}

function agentTurn(state: GameState): GameState {
  const next = agentMove(state);
  expect(next).not.toBeNull();
  if (next === null) throw new Error("expected agent move");
  return next;
}

describe("newGame", () => {
  it("sizes the board, leaves cells empty, and defaults to human", () => {
    const ttt = newGame("tictactoe");
    expect(rows("tictactoe")).toBe(3);
    expect(cols("tictactoe")).toBe(3);
    expect(ttt.cells).toHaveLength(9);
    expect(ttt.cells.every((c) => c === null)).toBe(true);
    expect(ttt.turn).toBe("human");
    expect(status(ttt)).toBe("human");

    const c4 = newGame("connect4");
    expect(rows("connect4")).toBe(6);
    expect(cols("connect4")).toBe(7);
    expect(c4.cells).toHaveLength(42);
    expect(c4.cells.every((c) => c === null)).toBe(true);
    expect(c4.turn).toBe("human");
  });

  it("starts with agent to move when starter is agent", () => {
    expect(newGame("tictactoe", "agent").turn).toBe("agent");
    expect(status(newGame("connect4", "agent"))).toBe("agent");
  });
});

describe("tic-tac-toe play", () => {
  it("rejects occupied cells, bad indexes, and moves after game over", () => {
    let s = newGame("tictactoe");
    s = tttPlay(s, 0);
    expect(play(s, 0)).toBeNull();
    expect(play(s, -1)).toBeNull();
    expect(play(s, 9)).toBeNull();

    s = newGame("tictactoe");
    s = tttPlay(s, 0);
    s = tttPlay(s, 4);
    s = tttPlay(s, 1);
    s = tttPlay(s, 5);
    s = tttPlay(s, 2);
    expect(status(s)).toBe("human-win");
    expect(play(s, 8)).toBeNull();
  });

  it("does not mutate the previous state", () => {
    const before = newGame("tictactoe");
    const cellsBefore = before.cells.slice();
    const after = play(before, 4);
    expect(before.cells).toEqual(cellsBefore);
    expect(after?.cells[4]).toBe("human");
  });

  it("detects row, column, and diagonal wins and winningLine", () => {
    let s = newGame("tictactoe");
    s = tttPlay(s, 0);
    s = tttPlay(s, 3);
    s = tttPlay(s, 1);
    s = tttPlay(s, 4);
    s = tttPlay(s, 2);
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)).toEqual([0, 1, 2]);

    s = newGame("tictactoe");
    s = tttPlay(s, 0);
    s = tttPlay(s, 1);
    s = tttPlay(s, 3);
    s = tttPlay(s, 2);
    s = tttPlay(s, 6);
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)).toEqual([0, 3, 6]);

    s = newGame("tictactoe");
    s = tttPlay(s, 0);
    s = tttPlay(s, 1);
    s = tttPlay(s, 4);
    s = tttPlay(s, 2);
    s = tttPlay(s, 8);
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)).toEqual([0, 4, 8]);

    s = newGame("tictactoe", "agent");
    s = tttPlay(s, 0);
    s = tttPlay(s, 1);
    s = tttPlay(s, 3);
    s = tttPlay(s, 4);
    s = tttPlay(s, 6);
    expect(status(s)).toBe("agent-win");
    expect(winningLine(s)).toEqual([0, 3, 6]);
  });

  it("calls a full board with no three-in-a-row a draw", () => {
    const cells: GameState["cells"] = [
      "human", "agent", "human",
      "human", "agent", "agent",
      "agent", "human", "human",
    ];
    const s: GameState = { kind: "tictactoe", cells, turn: "human" };
    expect(status(s)).toBe("draw");
    expect(winningLine(s)).toBeNull();
  });
});

describe("tic-tac-toe agent", () => {
  it("blocks an immediate human win", () => {
    let s = newGame("tictactoe");
    s = tttPlay(s, 0);
    s = tttPlay(s, 3);
    s = tttPlay(s, 1);
    expect(status(s)).toBe("agent");
    s = agentTurn(s);
    expect(s.cells[2]).toBe("agent");
  });

  it("takes an immediate win", () => {
    let s = newGame("tictactoe");
    s = tttPlay(s, 0);
    s = tttPlay(s, 4);
    s = tttPlay(s, 1);
    s = tttPlay(s, 5);
    s = tttPlay(s, 8);
    expect(status(s)).toBe("agent");
    s = agentTurn(s);
    expect(status(s)).toBe("agent-win");
    expect(winningLine(s)).toEqual([3, 4, 5]);
  });

  it("opens in the center from a fresh board", () => {
    const s = agentTurn(newGame("tictactoe", "agent"));
    expect(s.cells[4]).toBe("agent");
  });

  it("plays an edge when corners would allow a human fork", () => {
    const cells: GameState["cells"] = Array.from({ length: 9 }, () => null);
    cells[0] = "human";
    cells[4] = "agent";
    cells[8] = "human";
    const s: GameState = { kind: "tictactoe", cells, turn: "agent" };
    const next = agentTurn(s);
    const at = next.cells.findIndex((c, i) => c === "agent" && cells[i] === null);
    expect([1, 3, 5, 7]).toContain(at);
  });

  it("never loses when the human always takes the first legal cell", () => {
    let s = newGame("tictactoe");
    for (let guard = 0; guard < 20; guard++) {
      const st = status(s);
      if (st === "human-win") {
        throw new Error("agent lost");
      }
      if (st === "agent-win" || st === "draw") break;

      if (st === "human") {
        const move = s.cells.findIndex((c) => c === null);
        s = tttPlay(s, move);
      } else {
        s = agentTurn(s);
      }
    }
    const end = status(s);
    expect(end === "agent-win" || end === "draw").toBe(true);
  });
});

function c4Play(state: GameState, column: number): GameState {
  const next = play(state, column);
  expect(next).not.toBeNull();
  if (next === null) throw new Error("expected legal connect-four move");
  return next;
}

describe("connect 4 play", () => {
  it("stacks pieces from the bottom of a column", () => {
    let s = newGame("connect4");
    s = c4Play(s, 0);
    expect(s.cells[5 * 7 + 0]).toBe("human");
    s = c4Play(s, 0);
    expect(s.cells[4 * 7 + 0]).toBe("agent");
  });

  it("rejects a full column", () => {
    let s = newGame("connect4");
    for (let i = 0; i < 6; i++) {
      s = c4Play(s, 0);
    }
    expect(play(s, 0)).toBeNull();
  });

  it("detects horizontal, vertical, and diagonal wins", () => {
    let s = newGame("connect4");
    for (let col = 0; col < 4; col++) {
      s = c4Play(s, col);
      if (col < 3) s = c4Play(s, 6);
    }
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)?.length).toBe(4);

    s = newGame("connect4");
    s = c4Play(s, 0);
    s = c4Play(s, 1);
    s = c4Play(s, 0);
    s = c4Play(s, 1);
    s = c4Play(s, 0);
    s = c4Play(s, 1);
    s = c4Play(s, 0);
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)?.length).toBe(4);

    const diag: GameState["cells"] = Array.from({ length: 42 }, () => null);
    for (const [row, col] of [
      [2, 0],
      [3, 1],
      [4, 2],
      [5, 3],
    ] as const) {
      diag[row * 7 + col] = "human";
    }
    const diagonal = { kind: "connect4" as const, cells: diag, turn: "agent" as const };
    expect(status(diagonal)).toBe("human-win");
    expect(winningLine(diagonal)?.length).toBe(4);
  });

  it("treats a win on the last cell as a win, not a draw", () => {
    const cells: GameState["cells"] = Array.from({ length: 42 }, (_, i) => {
      const row = Math.floor(i / 7);
      const col = i % 7;
      if (col === 0 && row >= 2) return "human";
      return (row + col) % 2 === 0 ? "agent" : "human";
    });
    const s: GameState = { kind: "connect4", cells, turn: "agent" };
    expect(s.cells.every((c) => c !== null)).toBe(true);
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)).not.toBeNull();
  });
});

describe("connect 4 agent", () => {
  it("takes an immediate vertical win", () => {
    const cells: GameState["cells"] = Array.from({ length: 42 }, () => null);
    for (const row of [5, 4, 3]) cells[row * 7 + 1] = "agent";
    cells[5 * 7 + 0] = "human";
    const s: GameState = { kind: "connect4", cells, turn: "agent" };
    const next = agentTurn(s);
    expect(status(next)).toBe("agent-win");
    expect(winningLine(next)?.length).toBe(4);
  });

  it("takes an immediate horizontal win when available", () => {
    const cells: GameState["cells"] = Array.from({ length: 42 }, () => null);
    for (const col of [1, 2, 3]) cells[5 * 7 + col] = "agent";
    cells[5 * 7 + 0] = "human";
    const s: GameState = { kind: "connect4", cells, turn: "agent" };
    const next = agentTurn(s);
    expect(status(next)).toBe("agent-win");
  });

  it("blocks an immediate human four-in-a-row when it cannot win", () => {
    const cells: GameState["cells"] = Array.from({ length: 42 }, () => null);
    for (const col of [1, 2, 3]) cells[5 * 7 + col] = "human";
    cells[5 * 7 + 4] = "agent";
    const s: GameState = { kind: "connect4", cells, turn: "agent" };
    const next = agentTurn(s);
    expect(next.cells[5 * 7 + 0]).toBe("agent");
    expect(status(next)).not.toBe("human-win");
  });

  it("opens in column 3 on an empty board", () => {
    const s = agentTurn(newGame("connect4", "agent"));
    expect(s.cells[5 * 7 + 3]).toBe("agent");
  });
});

function fourPlay(state: GameState, at: number): GameState {
  const next = play(state, at);
  expect(next).not.toBeNull();
  if (next === null) throw new Error("expected legal four move");
  return next;
}

/** Like connect-four tests: human builds a row while agent stacks in column 6. */
function fourPlayRowWin(state: GameState): GameState {
  let s = state;
  for (let col = 0; col < 4; col++) {
    s = fourPlay(s, col);
    if (col < 3) s = fourPlay(s, 6 + col * 7);
  }
  return s;
}

describe("four newGame and dimensions", () => {
  it("has 49 empty cells, human to move, 7 rows and 7 cols", () => {
    const s = newGame("four");
    expect(rows("four")).toBe(7);
    expect(cols("four")).toBe(7);
    expect(s.cells).toHaveLength(49);
    expect(s.cells.every((c) => c === null)).toBe(true);
    expect(s.turn).toBe("human");
    expect(status(s)).toBe("human");
  });
});

describe("four play", () => {
  it("places at cell index 0 only, rejects occupied and index 49", () => {
    let s = newGame("four");
    s = fourPlay(s, 0);
    expect(s.cells[0]).toBe("human");
    expect(s.cells.filter((c) => c !== null)).toHaveLength(1);
    expect(play(s, 0)).toBeNull();
    expect(play(s, 49)).toBeNull();
  });

  it("detects horizontal and vertical four-in-a-row wins", () => {
    const s = fourPlayRowWin(newGame("four"));
    expect(status(s)).toBe("human-win");
    expect(winningLine(s)?.length).toBe(4);

    const vertical: GameState["cells"] = Array.from({ length: 49 }, () => null);
    for (const row of [0, 1, 2, 3]) vertical[row * 7 + 5] = "human";
    const sVertical: GameState = { kind: "four", cells: vertical, turn: "agent" };
    expect(status(sVertical)).toBe("human-win");
    expect(winningLine(sVertical)?.length).toBe(4);
  });
});

describe("four agent", () => {
  it("wins with three agent marks at 0, 1, 2", () => {
    const cells: GameState["cells"] = Array.from({ length: 49 }, () => null);
    cells[0] = "agent";
    cells[1] = "agent";
    cells[2] = "agent";
    const s: GameState = { kind: "four", cells, turn: "agent" };
    const next = agentTurn(s);
    expect(next.cells[3]).toBe("agent");
    expect(status(next)).toBe("agent-win");
  });

  it("blocks human four-in-a-row at 0, 1, 2", () => {
    const cells: GameState["cells"] = Array.from({ length: 49 }, () => null);
    cells[0] = "human";
    cells[1] = "human";
    cells[2] = "human";
    const s: GameState = { kind: "four", cells, turn: "agent" };
    const next = agentTurn(s);
    expect(next.cells[3]).toBe("agent");
  });

  it("opens at cell 24 on an empty board", () => {
    const s = agentTurn(newGame("four", "agent"));
    expect(s.cells[24]).toBe("agent");
  });
});

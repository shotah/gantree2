export type GameKind = "tictactoe" | "connect4" | "four";
export type Seat = "human" | "agent";
/** Empty cells are null. */
export type Cell = Seat | null;
export type GameStatus = "human" | "agent" | "human-win" | "agent-win" | "draw";

export type GameState = {
  kind: GameKind;
  /** Row-major, row 0 is the TOP of the board. Tic-tac-toe length 9. Connect 4 length 42 (6*7). Four length 49 (7*7). */
  cells: Cell[];
  /** Whose turn it is. Meaningless once the game is over; status() decides. */
  turn: Seat;
};

export function rows(kind: GameKind): number {
  if (kind === "tictactoe") return 3;
  if (kind === "four") return 7;
  return 6;
}

export function cols(kind: GameKind): number {
  if (kind === "tictactoe") return 3;
  return 7;
}

function winLength(kind: GameKind): number {
  return kind === "tictactoe" ? 3 : 4;
}

function boardSize(kind: GameKind): number {
  return rows(kind) * cols(kind);
}

function other(seat: Seat): Seat {
  return seat === "human" ? "agent" : "human";
}

/** starter defaults to "human". Fresh empty board, that seat to move. */
export function newGame(kind: GameKind, starter: Seat = "human"): GameState {
  return {
    kind,
    cells: Array.from({ length: boardSize(kind) }, () => null),
    turn: starter,
  };
}

function idx(kind: GameKind, row: number, col: number): number {
  return row * cols(kind) + col;
}

function allLines(kind: GameKind): number[][] {
  const r = rows(kind);
  const c = cols(kind);
  const n = winLength(kind);
  const lines: number[][] = [];

  for (let row = 0; row < r; row++) {
    for (let col = 0; col <= c - n; col++) {
      const line: number[] = [];
      for (let k = 0; k < n; k++) line.push(idx(kind, row, col + k));
      lines.push(line);
    }
  }

  for (let col = 0; col < c; col++) {
    for (let row = 0; row <= r - n; row++) {
      const line: number[] = [];
      for (let k = 0; k < n; k++) line.push(idx(kind, row + k, col));
      lines.push(line);
    }
  }

  for (let row = 0; row <= r - n; row++) {
    for (let col = 0; col <= c - n; col++) {
      const line: number[] = [];
      for (let k = 0; k < n; k++) line.push(idx(kind, row + k, col + k));
      lines.push(line);
    }
  }

  for (let row = 0; row <= r - n; row++) {
    for (let col = n - 1; col < c; col++) {
      const line: number[] = [];
      for (let k = 0; k < n; k++) line.push(idx(kind, row + k, col - k));
      lines.push(line);
    }
  }

  return lines;
}

const LINES: Record<GameKind, number[][]> = {
  tictactoe: allLines("tictactoe"),
  connect4: allLines("connect4"),
  four: allLines("four"),
};

function lineWinner(state: GameState, line: number[]): Seat | null {
  const start = line[0];
  if (start === undefined) return null;
  const first = state.cells[start];
  if (first === null) return null;
  for (let i = 1; i < line.length; i++) {
    const at = line[i];
    if (at === undefined || state.cells[at] !== first) return null;
  }
  return first;
}

/** Indexes of one winning line (length 3 or 4), or null if nobody has won. Row-major indexes. */
export function winningLine(state: GameState): number[] | null {
  for (const line of LINES[state.kind]) {
    if (lineWinner(state, line) !== null) return line;
  }
  return null;
}

function isBoardFull(state: GameState): boolean {
  return state.cells.every((c) => c !== null);
}

/** "human" | "agent" while in progress. A result once someone has n-in-a-row or the board is full with no winner. A win beats a full board. */
export function status(state: GameState): GameStatus {
  const win = winningLine(state);
  if (win !== null) {
    const start = win[0];
    const seat = start === undefined ? null : state.cells[start];
    if (seat === "human") return "human-win";
    if (seat === "agent") return "agent-win";
  }
  if (isBoardFull(state)) return "draw";
  return state.turn;
}

function dropRow(state: GameState, column: number): number | null {
  const c = cols(state.kind);
  const r = rows(state.kind);
  for (let row = r - 1; row >= 0; row--) {
    const i = row * c + column;
    if (state.cells[i] === null) return row;
  }
  return null;
}

/**
 * Apply a move for state.turn.
 * Tic-tac-toe: `at` is a cell index 0..8 and that cell must be empty.
 * Four: `at` is a cell index 0..48 and that cell must be empty (free placement, row 0 is the top).
 * Connect 4: `at` is a COLUMN 0..6. The piece occupies the greatest row index in that column that is still null (row 0 is the top, so gravity fills from the bottom).
 * Return null if the game is already over, the seat to move doesn't match, or the move is illegal. Do not mutate the input.
 */
export function play(state: GameState, at: number): GameState | null {
  const st = status(state);
  if (st !== "human" && st !== "agent") return null;

  let cellIndex: number;
  if (state.kind === "tictactoe" || state.kind === "four") {
    const size = boardSize(state.kind);
    if (at < 0 || at >= size || !Number.isInteger(at)) return null;
    if (state.cells[at] !== null) return null;
    cellIndex = at;
  } else {
    if (at < 0 || at >= 7 || !Number.isInteger(at)) return null;
    const row = dropRow(state, at);
    if (row === null) return null;
    cellIndex = idx(state.kind, row, at);
  }

  const cells = state.cells.slice();
  cells[cellIndex] = state.turn;
  return {
    kind: state.kind,
    cells,
    turn: other(state.turn),
  };
}

function legalMoves(state: GameState): number[] {
  const st = status(state);
  if (st !== "human" && st !== "agent") return [];

  if (state.kind === "tictactoe" || state.kind === "four") {
    const moves: number[] = [];
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i] === null) moves.push(i);
    }
    return moves;
  }

  const moves: number[] = [];
  for (let col = 0; col < 7; col++) {
    if (dropRow(state, col) !== null) moves.push(col);
  }
  return moves;
}

function step(state: GameState, at: number): GameState | null {
  return play(state, at);
}

function minimaxTtt(state: GameState, maximizing: boolean, depth = 0): number {
  const st = status(state);
  if (st === "agent-win") return 10 - depth;
  if (st === "human-win") return depth - 10;
  if (st === "draw") return 0;

  const moves = legalMoves(state);
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = step(state, m);
      if (next === null) continue;
      best = Math.max(best, minimaxTtt(next, false, depth + 1));
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const next = step(state, m);
    if (next === null) continue;
    best = Math.min(best, minimaxTtt(next, true, depth + 1));
  }
  return best;
}

const TTT_MOVE_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];

function orderTttMoves(moves: number[]): number[] {
  const set = new Set(moves);
  const ordered: number[] = [];
  for (const m of TTT_MOVE_ORDER) {
    if (set.has(m)) ordered.push(m);
  }
  for (const m of moves) {
    if (!ordered.includes(m)) ordered.push(m);
  }
  return ordered;
}

function tttMoveRank(m: number): number {
  const i = TTT_MOVE_ORDER.indexOf(m);
  return i === -1 ? 99 : i;
}

function bestTttMove(state: GameState): number {
  const moves = orderTttMoves(legalMoves(state));
  const fallback = moves[0] ?? 0;
  for (const m of moves) {
    const next = step(state, m);
    if (next !== null && status(next) === "agent-win") return m;
  }
  let bestScore = -Infinity;
  let bestMove = fallback;
  let bestRank = tttMoveRank(bestMove);
  for (const m of moves) {
    const next = step(state, m);
    if (next === null) continue;
    const score = minimaxTtt(next, false);
    const rank = tttMoveRank(m);
    if (score > bestScore || (score === bestScore && rank < bestRank)) {
      bestScore = score;
      bestMove = m;
      bestRank = rank;
    }
  }
  return bestMove;
}

/** Connect 4: prefer center columns when scores tie (3, 2, 4, 1, 5, 0, 6). */
const C4_COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

const C4_SEARCH_DEPTH = 4;

function orderC4Moves(moves: number[]): number[] {
  const set = new Set(moves);
  const ordered: number[] = [];
  for (const col of C4_COLUMN_ORDER) {
    if (set.has(col)) ordered.push(col);
  }
  for (const m of moves) {
    if (!ordered.includes(m)) ordered.push(m);
  }
  return ordered;
}

function alphaBetaC4(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
): number {
  const st = status(state);
  if (st === "agent-win") return 10_000;
  if (st === "human-win") return -10_000;
  if (st === "draw") return 0;
  if (depth === 0) return 0;

  const moves = orderC4Moves(legalMoves(state));

  if (maximizing) {
    let value = -Infinity;
    for (const m of moves) {
      const next = step(state, m);
      if (next === null) continue;
      value = Math.max(value, alphaBetaC4(next, depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }
  let value = Infinity;
  for (const m of moves) {
    const next = step(state, m);
    if (next === null) continue;
    value = Math.min(value, alphaBetaC4(next, depth - 1, alpha, beta, true));
    beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}

function c4ColumnRank(col: number): number {
  const i = C4_COLUMN_ORDER.indexOf(col);
  return i === -1 ? 99 : i;
}

function bestC4Move(state: GameState): number {
  const moves = orderC4Moves(legalMoves(state));
  const fallback = moves[0] ?? 0;
  for (const m of moves) {
    const next = step(state, m);
    if (next !== null && status(next) === "agent-win") return m;
  }
  let bestScore = -Infinity;
  let bestMove = fallback;
  let bestRank = c4ColumnRank(bestMove);
  for (const m of moves) {
    const next = step(state, m);
    if (next === null) continue;
    const score = alphaBetaC4(next, C4_SEARCH_DEPTH - 1, -Infinity, Infinity, false);
    const rank = c4ColumnRank(m);
    if (score > bestScore || (score === bestScore && rank < bestRank)) {
      bestScore = score;
      bestMove = m;
      bestRank = rank;
    }
  }
  return bestMove;
}

const FOUR_CENTER = 24;
const FOUR_SEARCH_DEPTH = 2;

function fourCenterDistance(cell: number): number {
  const c = cols("four");
  const row = Math.floor(cell / c);
  const col = cell % c;
  return Math.abs(row - 3) + Math.abs(col - 3);
}

function orderFourMoves(moves: number[]): number[] {
  return [...moves].sort((a, b) => {
    const da = fourCenterDistance(a);
    const db = fourCenterDistance(b);
    if (da !== db) return da - db;
    return a - b;
  });
}

function fourMoveRank(m: number): [number, number] {
  return [fourCenterDistance(m), m];
}

function alphaBetaFour(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
): number {
  const st = status(state);
  if (st === "agent-win") return 10_000;
  if (st === "human-win") return -10_000;
  if (st === "draw") return 0;
  if (depth === 0) return 0;

  const moves = orderFourMoves(legalMoves(state));

  if (maximizing) {
    let value = -Infinity;
    for (const m of moves) {
      const next = step(state, m);
      if (next === null) continue;
      value = Math.max(value, alphaBetaFour(next, depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }
  let value = Infinity;
  for (const m of moves) {
    const next = step(state, m);
    if (next === null) continue;
    value = Math.min(value, alphaBetaFour(next, depth - 1, alpha, beta, true));
    beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}

function bestFourMove(state: GameState): number {
  const moves = orderFourMoves(legalMoves(state));
  const fallback = moves[0] ?? FOUR_CENTER;
  for (const m of moves) {
    const next = step(state, m);
    if (next !== null && status(next) === "agent-win") return m;
  }
  let bestScore = -Infinity;
  let bestMove = fallback;
  let bestRank = fourMoveRank(bestMove);
  for (const m of moves) {
    const next = step(state, m);
    if (next === null) continue;
    const score = alphaBetaFour(next, FOUR_SEARCH_DEPTH - 1, -Infinity, Infinity, false);
    const rank = fourMoveRank(m);
    if (
      score > bestScore
      || (score === bestScore
        && (rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])))
    ) {
      bestScore = score;
      bestMove = m;
      bestRank = rank;
    }
  }
  return bestMove;
}

/**
 * If status(state) is "agent", return the state after the agent's one move. Otherwise null.
 * Deterministic. Does not mutate the input.
 */
export function agentMove(state: GameState): GameState | null {
  if (status(state) !== "agent") return null;
  const at
    = state.kind === "tictactoe"
      ? bestTttMove(state)
      : state.kind === "four"
        ? bestFourMove(state)
        : bestC4Move(state);
  return play(state, at);
}

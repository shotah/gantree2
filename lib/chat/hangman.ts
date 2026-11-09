export type HangmanNode = {
  guess: string;
  hit?: HangmanNode;
  miss?: HangmanNode;
};

export type HangmanBoard = {
  secret: string;
  guessed: string[];
  lives: number;
};

type HangmanBoardState = HangmanBoard & { misses: string[] };

function withMisses(board: HangmanBoard): HangmanBoardState {
  return { ...board, misses: (board as HangmanBoardState).misses ?? [] };
}

function extractJsonSlice(text: string): string | null {
  let hay = text;
  const fenceStart = text.indexOf("```");
  if (fenceStart >= 0) {
    const fenceEnd = text.indexOf("```", fenceStart + 3);
    if (fenceEnd > fenceStart) {
      let inner = text.slice(fenceStart + 3, fenceEnd).trimStart();
      if (inner.toLowerCase().startsWith("json")) {
        inner = inner.slice(4).trimStart();
      }
      hay = inner;
    }
  }
  const start = hay.indexOf("{");
  if (start < 0) {
    return null;
  }
  let depth = 0;
  for (let i = start; i < hay.length; i++) {
    const ch = hay[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return hay.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function emptyBoard(secret: string): HangmanBoardState {
  return { secret: secret.toUpperCase(), guessed: [], lives: 6, misses: [] };
}

export function pattern(board: HangmanBoard): string {
  return board.secret
    .split("")
    .map((ch) => (board.guessed.includes(ch) ? ch : "_"))
    .join(" ");
}

export function won(board: HangmanBoard): boolean {
  return board.secret.split("").every((ch) => board.guessed.includes(ch));
}

export function lost(board: HangmanBoard): boolean {
  return board.lives <= 0;
}

export function applyGuess(
  board: HangmanBoard,
  letter: string,
): { board: HangmanBoard; hit: boolean; repeat: boolean } {
  const state = withMisses(board);
  const L = letter.trim().toUpperCase();
  if (!/^[A-Z]$/u.test(L)) {
    return { board: state, hit: false, repeat: false };
  }
  if (state.guessed.includes(L)) {
    return { board: state, hit: false, repeat: true };
  }
  const hit = state.secret.includes(L);
  const guessed = [...state.guessed, L];
  const lives = hit ? state.lives : state.lives - 1;
  const misses = hit ? state.misses : [...state.misses, L];
  const next: HangmanBoardState = { ...state, guessed, lives, misses };
  return {
    board: next,
    hit,
    repeat: false,
  };
}

function normalizeGraphNode(raw: unknown, depth: number): HangmanNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.guess !== "string") {
    return null;
  }
  const guess = rec.guess.trim();
  if (!/^[A-Za-z]$/u.test(guess)) {
    return null;
  }
  const node: HangmanNode = { guess: guess.toUpperCase() };

  if (depth < 4) {
    if (rec.hit !== undefined) {
      const hit = normalizeGraphNode(rec.hit, depth + 1);
      if (hit) {
        node.hit = hit;
      }
    }
    if (rec.miss !== undefined) {
      const miss = normalizeGraphNode(rec.miss, depth + 1);
      if (miss) {
        node.miss = miss;
      }
    }
  }

  return node;
}

export function walkGraph(
  board: HangmanBoard,
  node: HangmanNode,
): { board: HangmanBoard; steps: { letter: string; hit: boolean }[] } {
  let current = board;
  const steps: { letter: string; hit: boolean }[] = [];
  let cursor: HangmanNode | undefined = node;

  for (let step = 0; step < 8 && cursor; step++) {
    const { board: next, hit, repeat } = applyGuess(current, cursor.guess);
    if (repeat) {
      break;
    }
    steps.push({ letter: cursor.guess, hit });
    current = next;
    if (won(current) || lost(current)) {
      break;
    }
    const child: HangmanNode | undefined = hit ? cursor.hit : cursor.miss;
    if (!child) {
      break;
    }
    cursor = child;
  }

  return { board: current, steps };
}

export function parseHangmanWord(text: string): string | null {
  const slice = extractJsonSlice(text);
  if (!slice) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const word = (parsed as Record<string, unknown>).word;
  if (typeof word !== "string") {
    return null;
  }
  const trimmed = word.trim();
  if (trimmed.length < 4 || trimmed.length > 12) {
    return null;
  }
  if (!/^[A-Za-z]+$/u.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
}

export function parseHangmanGraph(text: string): HangmanNode | null {
  const slice = extractJsonSlice(text);
  if (!slice) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  return normalizeGraphNode(parsed, 0);
}

function wrongGuesses(board: HangmanBoard): string[] {
  return withMisses(board).misses;
}

export function hangmanAskWord(agentName: string): string {
  return `${agentName}, Hangman. You pick the secret word. Reply with one JSON object and nothing else: {"word":"<a real word of 4 to 12 letters>"}.`;
}

export function hangmanAskGraph(agentName: string, board: HangmanBoard): string {
  const misses = wrongGuesses(board);
  const missText = misses.length ? misses.join(", ") : "none";
  return `${agentName}, Hangman. Secret word is ${board.secret.length} letters. Pattern is ${pattern(board)}. Misses: ${missText}. ${board.lives} wrong guesses left. Reply with one JSON object and nothing else. Next guess, then both hit and miss, nested two guesses further. Example: {"guess":"E","hit":{"guess":"A","hit":{"guess":"R"},"miss":{"guess":"S"}},"miss":{"guess":"A","hit":{"guess":"O"},"miss":{"guess":"I"}}}. Do not repeat a guessed letter.`;
}

/** Closing note. Not a request for JSON. guesser "you" means the human was guessing Kit's word. guesser "agent" means Kit was guessing the human's word. */
export function hangmanResult(
  agentName: string,
  board: HangmanBoard,
  guesser: "you" | "agent",
): string {
  let outcome: string;
  if (guesser === "you") {
    outcome = won(board) ? "I got it." : "I lost.";
  } else {
    outcome = won(board) ? "You got it." : "You lost.";
  }
  const guesses = board.guessed.length ? board.guessed.join(", ") : "none";
  const misses = wrongGuesses(board);
  const missText = misses.length ? misses.join(", ") : "none";
  return `${agentName}, Hangman. ${outcome} Word was ${board.secret}. Pattern is ${pattern(board)}. Guesses: ${guesses}. Misses: ${missText}. ${board.lives} wrong guesses left.`;
}

export function redactHangmanSecret(text: string): string {
  if (parseHangmanWord(text)) {
    return "Picked a secret word.";
  }
  return text;
}

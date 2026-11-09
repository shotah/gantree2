export type GhostNode = {
  letter?: string;
  challenge?: string;
  word?: string;
  then?: Record<string, GhostNode>;
};

export type GhostStep
  = | { kind: "letter"; letter: string }
    | { kind: "challenge"; word: string }
    | { kind: "word"; word: string };

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

/** The move on this node. Null if it does not have exactly one of letter (one A-Z), challenge (non-empty), or word (non-empty). */
export function stepNode(node: GhostNode): GhostStep | null {
  const hasLetter = node.letter !== undefined;
  const hasChallenge = node.challenge !== undefined;
  const hasWord = node.word !== undefined;
  const count = Number(hasLetter) + Number(hasChallenge) + Number(hasWord);
  if (count !== 1) {
    return null;
  }
  if (hasLetter) {
    const letter = node.letter ?? "";
    if (!/^[A-Z]$/u.test(letter)) {
      return null;
    }
    return { kind: "letter", letter };
  }
  if (hasChallenge) {
    const word = (node.challenge ?? "").trim();
    if (!word) {
      return null;
    }
    return { kind: "challenge", word };
  }
  const word = (node.word ?? "").trim();
  if (!word) {
    return null;
  }
  return { kind: "word", word };
}

function normalizeNode(raw: unknown, depth: number): GhostNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const node: GhostNode = {};

  if (typeof rec.letter === "string") {
    const letter = rec.letter.trim();
    if (/^[A-Za-z]$/u.test(letter)) {
      node.letter = letter.toUpperCase();
    }
  }
  if (typeof rec.challenge === "string") {
    const challenge = rec.challenge.trim();
    if (challenge) {
      node.challenge = challenge;
    }
  }
  if (typeof rec.word === "string") {
    const word = rec.word.trim();
    if (word) {
      node.word = word;
    }
  }

  if (!stepNode(node)) {
    return null;
  }

  if (depth < 4 && rec.then && typeof rec.then === "object" && !Array.isArray(rec.then)) {
    const then: Record<string, GhostNode> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(rec.then as Record<string, unknown>)) {
      if (kept >= 6) {
        break;
      }
      if (!/^[A-Za-z]$/u.test(key)) {
        continue;
      }
      const child = normalizeNode(value, depth + 1);
      if (!child || !stepNode(child)) {
        continue;
      }
      then[key.toUpperCase()] = child;
      kept++;
    }
    if (Object.keys(then).length > 0) {
      node.then = then;
    }
  }

  return node;
}

/** Pull the first JSON object out of the reply (raw or fenced in ```). Validate. Null if it is not one move. */
export function parseGhostGraph(text: string): GhostNode | null {
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
  const node = normalizeNode(parsed, 0);
  if (!node || !stepNode(node)) {
    return null;
  }
  return node;
}

/** Kit already played `node`. The human's next letter. The child if `then` has that letter, else null. */
export function branch(node: GhostNode, letter: string): GhostNode | null {
  const child = node.then?.[letter.toUpperCase()];
  if (!child || !stepNode(child)) {
    return null;
  }
  return child;
}

export function ghostSeed(agentName: string, stem: string, path: string): string {
  return `${agentName}, Ghost. Stem is ${stem || "(empty)"}. ${path}Reply with one JSON object and nothing else. Your move plus 2 to 4 replies I might play, nested one level further. Example: {"letter":"U","then":{"A":{"letter":"R","then":{"T":{"word":"QUART"}}},"I":{"challenge":"QUIET"}}}. Use challenge or word instead of letter to end the round. word only for a real word of 4 or more letters.`;
}

export function ghostChallenge(agentName: string, stem: string): string {
  return `${agentName}, Ghost. Stem is ${stem}. I challenge. Reply with one JSON object and nothing else: {"challenge":"<a word that starts with ${stem}>"}.`;
}

export function ghostResult(agentName: string, stem: string, path: string, status: string): string {
  return `${agentName}, Ghost. ${status} Stem is ${stem}.${path ? ` Path: ${path}.` : ""}`;
}

export function redactGhostGraph(text: string): string {
  if (parseGhostGraph(text)) {
    return "Ghost reply.";
  }
  return text;
}

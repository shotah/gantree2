import { describe, expect, it } from "vitest";
import {
  branch,
  ghostChallenge,
  ghostResult,
  ghostSeed,
  parseGhostGraph,
  redactGhostGraph,
  stepNode,
} from "@/lib/chat/ghost";

describe("ghostSeed", () => {
  it("names the stem and path prefix", () => {
    expect(ghostSeed("Kit", "Q", "I add Q. ")).toBe(
      "Kit, Ghost. Stem is Q. I add Q. Reply with one JSON object and nothing else. Your move plus 2 to 4 replies I might play, nested one level further. Example: {\"letter\":\"U\",\"then\":{\"A\":{\"letter\":\"R\",\"then\":{\"T\":{\"word\":\"QUART\"}}},\"I\":{\"challenge\":\"QUIET\"}}}. Use challenge or word instead of letter to end the round. word only for a real word of 4 or more letters.",
    );
    expect(ghostSeed("Kit", "", "You start. ")).toContain("Stem is (empty). You start. ");
  });
});

describe("ghostChallenge", () => {
  it("asks for challenge JSON", () => {
    expect(ghostChallenge("Kit", "QU")).toBe(
      'Kit, Ghost. Stem is QU. I challenge. Reply with one JSON object and nothing else: {"challenge":"<a word that starts with QU>"}.',
    );
  });
});

describe("parseGhostGraph", () => {
  it("reads a fenced graph", () => {
    const text = "Here you go:\n```json\n{\"letter\":\"U\",\"then\":{\"A\":{\"letter\":\"R\"}}}\n```";
    const graph = parseGhostGraph(text);
    expect(graph?.letter).toBe("U");
    expect(graph?.then?.A?.letter).toBe("R");
  });

  it("rejects a node with two move fields", () => {
    expect(parseGhostGraph('{"letter":"Q","word":"QUACK"}')).toBeNull();
  });
});

describe("stepNode", () => {
  it("returns the single move on a node", () => {
    expect(stepNode({ letter: "U" })).toEqual({ kind: "letter", letter: "U" });
    expect(stepNode({ challenge: "quiet" })).toEqual({ kind: "challenge", word: "quiet" });
  });
});

describe("ghostResult", () => {
  it("reports round end with stem and path", () => {
    expect(ghostResult("Kit", "SAVANT", "S(Kit) A(you)", "Kit says that's a word: SAVANT.")).toBe(
      "Kit, Ghost. Kit says that's a word: SAVANT. Stem is SAVANT. Path: S(Kit) A(you).",
    );
  });
});

describe("redactGhostGraph", () => {
  it("hides ghost graphs in the thread", () => {
    expect(redactGhostGraph('{"letter":"U","then":{"A":{"word":"QUA"}}}')).toBe("Ghost reply.");
    expect(redactGhostGraph("hello")).toBe("hello");
    expect(redactGhostGraph('{"guess":"E"}')).toBe('{"guess":"E"}');
  });
});

describe("branch", () => {
  it("follows a keyed child", () => {
    const graph = parseGhostGraph('{"letter":"U","then":{"A":{"letter":"R"},"Z":{"letter":"X"}}}');
    expect(graph).not.toBeNull();
    if (!graph) {
      return;
    }
    expect(branch(graph, "A")?.letter).toBe("R");
  });

  it("returns null on a miss", () => {
    const graph = parseGhostGraph('{"letter":"U","then":{"A":{"letter":"R"},"Z":{"letter":"X"}}}');
    expect(graph).not.toBeNull();
    if (!graph) {
      return;
    }
    expect(branch(graph, "M")).toBeNull();
  });
});

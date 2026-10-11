import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_REPL_NOTE,
  LOOPBACK_REDIRECT,
  type AgentArgs,
  type FrameView,
  type PaintState,
  baseHost,
  commandHead,
  dbPath,
  displayDb,
  formatBanner,
  paint,
  parseArgs,
  personaHint,
  renderFrame,
  resetDb,
} from "@/scripts/agent";
import type { BrainFrame } from "@/brain/core/wire";

const defaults: AgentArgs = { slug: "kit", db: null, fresh: false, verbose: false, once: false };

function shown(frame: BrainFrame, opts: { slug: string; verbose: boolean } = { slug: "kit", verbose: false }): FrameView {
  const view = renderFrame(frame, opts);
  if (view == null) throw new Error(`expected a view for ${frame.kind ?? "frame"}`);
  return view;
}

describe("parseArgs", () => {
  it("defaults to kit with no flags", () => {
    expect(parseArgs([])).toEqual(defaults);
  });

  it("reads slug, db, fresh, verbose, and once", () => {
    expect(parseArgs(["--slug", "ada", "--db", "notes.sqlite", "--fresh", "--verbose", "--once"])).toEqual({
      slug: "ada",
      db: "notes.sqlite",
      fresh: true,
      verbose: true,
      once: true,
    });
    expect(parseArgs(["--slug=ada", "--db=notes.sqlite"])).toMatchObject({ slug: "ada", db: "notes.sqlite" });
  });

  it("rejects an unknown flag, a bare word, and a bad slug", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["hello"])).toThrow(/unexpected argument/);
    expect(() => parseArgs(["--slug"])).toThrow(/missing value for --slug/);
    expect(() => parseArgs(["--slug", ""])).toThrow(/bad slug/);
  });
});

describe("db path", () => {
  it("defaults under .agent and honors --db", () => {
    expect(dbPath("kit", null, "/repo")).toBe("/repo/.agent/kit.sqlite");
    expect(dbPath("kit", "other.sqlite", "/repo")).toBe("/repo/other.sqlite");
    expect(displayDb("/repo/.agent/kit.sqlite", "/repo")).toBe(".agent/kit.sqlite");
    expect(displayDb("/tmp/kit.sqlite", "/repo")).toBe("/tmp/kit.sqlite");
  });

  it("deletes the sqlite file and sidecars on --fresh", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-repl-"));
    const path = join(dir, "kit.sqlite");
    try {
      writeFileSync(path, "keep");
      writeFileSync(`${path}-wal`, "wal");
      writeFileSync(`${path}-shm`, "shm");
      resetDb(path, false);
      expect(existsSync(path)).toBe(true);
      resetDb(path, true);
      expect(existsSync(path)).toBe(false);
      expect(existsSync(`${path}-wal`)).toBe(false);
      expect(existsSync(`${path}-shm`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("frame printer", () => {
  const opts = { slug: "kit", verbose: false };

  it("prints a reply as slug> text and a react as the emoji", () => {
    expect(shown({ kind: "reply", text: "hello" }, opts)).toEqual({ text: "kit> hello", overwrite: false, dim: false });
    expect(shown({ kind: "react", text: "👍" }, opts).text).toBe("👍");
    expect(shown({ kind: "push", text: "ping" }, opts).text).toBe("kit> ping");
  });

  it("overwrites typing and cumulative drafts in place on a terminal", () => {
    expect(shown({ kind: "typing" }, opts)).toEqual({ text: "…", overwrite: true, dim: true });
    const state: PaintState = { pending: false };
    const first = shown({ kind: "draft", text: "hel" }, opts);
    const second = shown({ kind: "draft", text: "hello" }, opts);
    expect(paint(state, first, true)).toBe("\r\x1b[2Khel");
    expect(paint(state, second, true)).toBe("\r\x1b[2Khello");
    expect(state.pending).toBe(true);
    const reply = shown({ kind: "reply", text: "hello" }, opts);
    expect(paint(state, reply, true)).toBe("\nkit> hello\n");
    expect(state.pending).toBe(false);
    expect(paint({ pending: false }, first, false)).toBe("");
  });

  it("puts perf and status on one dim line each", () => {
    const perf = shown({
      kind: "perf",
      tokens: { prompt: 12, completion: 3 },
      iterations: 2,
      tool_calls: 4,
    }, opts);
    expect(perf.dim).toBe(true);
    expect(perf.overwrite).toBe(false);
    expect(perf.text).toBe("perf tool_calls=4 iterations=2 tokens=12/3");
    expect(perf.text.includes("\n")).toBe(false);
    const status = shown({
      kind: "status",
      published: ["math"],
      skipped: [{ name: "strava", reason: "no_oauth" }],
    }, opts);
    expect(status).toEqual({
      text: "status published=math skipped=strava(no_oauth)",
      overwrite: false,
      dim: true,
    });
    const state: PaintState = { pending: false };
    expect(paint(state, perf, true)).toBe(`\x1b[2m${perf.text}\x1b[0m\n`);
    expect(paint({ pending: false }, perf, false)).toBe(`${perf.text}\n`);
  });

  it("hides log lines unless verbose", () => {
    const frame: BrainFrame = { kind: "log", level: "info", message: "opened" };
    expect(renderFrame(frame, opts)).toBeNull();
    expect(shown(frame, { slug: "kit", verbose: true }).text).toBe("log info opened");
  });

  it("formats the banner with the host and skip summary", () => {
    expect(baseHost("https://generativelanguage.googleapis.com/v1beta/openai")).toBe("generativelanguage.googleapis.com");
    expect(baseHost("not a url")).toBe("unknown-host");
    expect(formatBanner({
      model: "gemini",
      host: "generativelanguage.googleapis.com",
      db: ".agent/kit.sqlite",
      skipped: [
        { name: "strava", reason: "no_oauth" },
        { name: "garmin", reason: "no_key" },
      ],
    })).toBe("gemini  generativelanguage.googleapis.com  .agent/kit.sqlite  skipped: strava(no_oauth) garmin(no_key)");
    expect(personaHint(".agent/kit.sqlite")).toBe("PERSONA.md is a row in .agent/kit.sqlite");
    expect(commandHead("/auth google")).toBe("/auth");
    expect(AUTH_REPL_NOTE).toContain("/auth <plugin> <code>");
    expect(AUTH_REPL_NOTE).toContain(LOOPBACK_REDIRECT);
  });
});

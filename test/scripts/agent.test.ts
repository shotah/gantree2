import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backoffMs,
  DEFAULT_BASE,
  gantryBin,
  harnessEnv,
  HARNESS_DIR,
  missingLlm,
  onRoom,
  parseAgentArgs,
  prefixLines,
  prepareRunDir,
  runDirs,
  slugsFromBoard,
  socketUrl,
  stopAll,
  withMe,
} from "@/scripts/agent";

const ME = { sub: "118212345678901234567", email: "ada@example.com" };

const tmp: string[] = [];
afterEach(() => {
  for (const dir of tmp.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent args", () => {
  it("takes slugs, --build, and --base", () => {
    expect(parseAgentArgs([])).toEqual({ help: false, build: false, base: DEFAULT_BASE, slugs: [] });
    expect(parseAgentArgs(["--build", "Kit", "--base=http://127.0.0.1:3001", "ada"])).toEqual({
      help: false,
      build: true,
      base: "http://127.0.0.1:3001",
      slugs: ["kit", "ada"],
    });
    expect(parseAgentArgs(["-h"]).help).toBe(true);
    expect(() => parseAgentArgs(["--nope"])).toThrow(/unknown arg/);
    expect(() => parseAgentArgs(["--base="])).toThrow(/usage/);
  });

  it("finds the binary under harness/bin unless GANTRY_BIN says otherwise", () => {
    expect(gantryBin({})).toBe(join(HARNESS_DIR, "bin", process.platform === "win32" ? "gantry.exe" : "gantry"));
    expect(gantryBin({ GANTRY_BIN: " /tmp/g " })).toBe("/tmp/g");
  });
});

describe("harness env", () => {
  const vars = new Map([
    ["LLM_BASE_URL", "https://llm.example/v1"],
    ["LLM_API_KEY", "sekrit"],
    ["LLM_MODEL", "m"],
    ["GOOGLE_CLIENT_SECRET", "never"],
    ["SESSION_SECRET", "never"],
  ]);

  it("names the LLM keys .dev.vars is missing", () => {
    expect(missingLlm(vars)).toEqual([]);
    expect(missingLlm(new Map([["LLM_MODEL", " "]]))).toEqual(["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);
  });

  it("dials /ws/<slug> as ws:// on http and wss:// on https", () => {
    expect(socketUrl("http://127.0.0.1:3000", "kit")).toBe("ws://127.0.0.1:3000/ws/kit");
    expect(socketUrl("https://g.example/?x=1", "ada")).toBe("wss://g.example/ws/ada");
  });

  it("is the container dial-back plus the house keys plus local paths, and nothing else from .dev.vars", () => {
    const dirs = runDirs("kit", "/run");
    const env = harnessEnv({ vars, base: "http://127.0.0.1:3000", slug: "kit", bearer: "tok", dirs, path: "/usr/bin" });
    expect(env).toEqual({
      LLM_BASE_URL: "https://llm.example/v1",
      LLM_API_KEY: "sekrit",
      LLM_MODEL: "m",
      CHANNEL: "chat",
      CHAT_MAILBOX_URL: "ws://127.0.0.1:3000/ws/kit",
      CHAT_BEARER: "tok",
      SNAPSHOT: "true",
      SNAPSHOT_INTERVAL: "5m",
      DATA_DIR: "/run/kit/data",
      PERSONA_DIR: "/run/kit/persona",
      MCP_MANIFEST: "/run/kit/mcp.toml",
      PATH: `${join(HARNESS_DIR, "bin")}:/usr/bin`,
    });
    expect(JSON.stringify(env)).not.toContain("never");
    expect(harnessEnv({ vars, base: DEFAULT_BASE, slug: "kit", bearer: "tok", dirs, path: undefined }).PATH).toBe(join(HARNESS_DIR, "bin"));
  });

  it("seeds the run dir once: persona from the example, an empty manifest, a data dir", () => {
    const root = mkdtempSync(join(tmpdir(), "gantree-agent-"));
    tmp.push(root);
    const seed = join(root, "seed.md");
    writeFileSync(seed, "# PERSONA\n");
    const dirs = runDirs("kit", root);
    prepareRunDir(dirs, seed);
    expect(existsSync(dirs.data)).toBe(true);
    expect(readFileSync(join(dirs.persona, "PERSONA.md"), "utf8")).toBe("# PERSONA\n");
    expect(readFileSync(dirs.mcp, "utf8")).toBe("");
    writeFileSync(join(dirs.persona, "PERSONA.md"), "edited\n");
    writeFileSync(dirs.mcp, "[[server]]\n");
    prepareRunDir(dirs, seed);
    expect(readFileSync(join(dirs.persona, "PERSONA.md"), "utf8")).toBe("edited\n");
    expect(readFileSync(dirs.mcp, "utf8")).toBe("[[server]]\n");
  });
});

describe("room and board", () => {
  it("knows when the dev user is already on the room, by sub or verified email", () => {
    expect(onRoom([], ME)).toBe(false);
    expect(onRoom([{ sub: ME.sub }], ME)).toBe(true);
    expect(onRoom([{ email: "ada@example.com" }], { ...ME, email: "Ada@Example.com" })).toBe(true);
    expect(onRoom([{ email: "sam@example.com" }], ME)).toBe(false);
    expect(withMe([{ email: "sam@example.com" }], ME)).toEqual([{ email: "sam@example.com" }, { sub: ME.sub, email: ME.email }]);
    expect(withMe([{ sub: ME.sub }], ME)).toEqual([{ sub: ME.sub }]);
  });

  it("reads slugs off the board", () => {
    expect(slugsFromBoard({ agents: [{ slug: "kit" }, { slug: "ada" }, { nope: 1 }] })).toEqual(["kit", "ada"]);
    expect(slugsFromBoard({ error: "x" })).toEqual([]);
    expect(slugsFromBoard(null)).toEqual([]);
  });
});

describe("supervision", () => {
  it("backs off 2, 4, 8 … capped at 30 s", () => {
    expect([0, 1, 2, 3, 4, 9].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("prefixes every line with the slug and keeps a trailing partial line", () => {
    expect(prefixLines("kit", "a\nb\n")).toBe("[kit] a\n[kit] b\n");
    expect(prefixLines("kit", "partial")).toBe("[kit] partial\n");
    expect(prefixLines("kit", "")).toBe("");
  });
});

/** A child that exits on SIGTERM after `termAfterMs`, or never when undefined. */
class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];

  constructor(private readonly termAfterMs?: number) {
    super();
  }

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    const finish = (code: NodeJS.Signals): void => {
      this.signalCode = code;
      this.emit("exit", null, code);
    };
    if (signal === "SIGKILL") {
      finish("SIGKILL");
    } else if (this.termAfterMs !== undefined) {
      setTimeout(() => finish("SIGTERM"), this.termAfterMs);
    }
    return true;
  }
}

describe("stopAll", () => {
  it("marks every run stopped, SIGTERMs the live children and waits for them", async () => {
    const kit = new FakeChild(10);
    const idle = { slug: "idle", child: null, stopped: false };
    const run = { slug: "kit", child: kit, stopped: false };
    expect(await stopAll([run, idle], 1000)).toEqual([]);
    expect(kit.signals).toEqual(["SIGTERM"]);
    expect(run.stopped).toBe(true);
    expect(idle.stopped).toBe(true);
  });

  it("SIGKILLs a harness that ignores SIGTERM past the wait and names it", async () => {
    const stuck = new FakeChild();
    const quick = new FakeChild(0);
    const killed = await stopAll([
      { slug: "stuck", child: stuck, stopped: false },
      { slug: "quick", child: quick, stopped: false },
    ], 30);
    expect(killed).toEqual(["stuck"]);
    expect(stuck.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(quick.signals).toEqual(["SIGTERM"]);
  });

  it("does not signal a child that already exited", async () => {
    const gone = new FakeChild();
    gone.exitCode = 1;
    expect(await stopAll([{ slug: "gone", child: gone, stopped: false }], 30)).toEqual([]);
    expect(gone.signals).toEqual([]);
  });
});

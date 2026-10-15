import { describe, expect, it } from "vitest";
import {
  applyHarnessFrame,
  emptyLog,
  emptyStatus,
  harnessKind,
  LOG_CAP,
  noteBrainOpen,
  pageLog,
  parseLog,
  parseStatus,
  stateFromPlugins,
  agentRunLabel,
  statusLabel,
} from "@/lib/agents/status";

const now = 1_700_000_000_000;

describe("harness frames", () => {
  it("recognises status, perf, and log", () => {
    expect(harnessKind("{\"kind\":\"status\"}")).toBe("status");
    expect(harnessKind("{\"kind\":\"reply\"}")).toBeNull();
    expect(harnessKind("nope")).toBeNull();
    expect(harnessKind("[]")).toBeNull();
    const bytes = new TextEncoder().encode("{\"kind\":\"log\"}");
    expect(harnessKind(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe("log");
  });

  it("folds status, perf, and log without touching phones' kinds", () => {
    const status = noteBrainOpen(emptyStatus(), now);
    let state = { status, log: emptyLog() };
    state = pick(applyHarnessFrame(state, { kind: "status", published: [" maps ", 1, ""], skipped: [{ name: "strava", reason: "no_key" }, { name: "" }] }, now, "kit"));
    expect(state.status.state).toBe("needs_keys");
    expect(state.status.plugins).toEqual([
      { name: "maps", state: "ready" },
      { name: "strava", state: "skipped", reason: "no_key" },
    ]);
    expect(state.status.published).toEqual(["maps"]);
    expect(state.status.skipped).toEqual([{ name: "strava", reason: "no_key" }]);
    expect(applyHarnessFrame(state, { kind: "status", published: ["math"], skipped: [{ name: "maps", reason: "error" }] }, now, "kit").status.state).toBe("error");
    expect(applyHarnessFrame(state, { kind: "status", published: ["math"], skipped: [{ name: "garmin", reason: "disabled" }] }, now, "kit").status.state).toBe("ready");

    const perf = applyHarnessFrame(state, { kind: "perf", outcome: "error", tokens: { prompt: 10, completion: 2 } }, now + 1, "kit");
    expect(perf.status.perf).toEqual({ turns: 1, prompt: 10, completion: 2, errors: 1 });
    expect(perf.status.lastTurnAt).toBe(now + 1);
    expect(perf.status.lastTurn).toBe(now + 1);
    expect(perf.samples.map((row) => row.kind)).toEqual(["tokens_prompt", "tokens_completion", "turn"]);
    expect(applyHarnessFrame(state, { kind: "perf", tokens: { prompt: -1, completion: Number.NaN } }, now, null).samples).toEqual([]);
    expect(applyHarnessFrame(state, { kind: "perf" }, now, "kit").status.perf.turns).toBe(1);

    const logged = applyHarnessFrame(state, { kind: "log", level: "INFO", message: "hi", at: "2026-10-10T00:00:00Z", dropped: 3 }, now, "kit");
    expect(logged.log.lines).toEqual([{ seq: 1, at: "2026-10-10T00:00:00Z", level: "info", message: "hi", dropped: 3 }]);
    expect(applyHarnessFrame(state, { kind: "log", message: "" }, now, "kit").log.lines).toEqual([]);
    const huge = applyHarnessFrame(state, { kind: "log", message: "😀".repeat(2001), at: "bad\n", dropped: 0 }, now, "kit");
    const clipped = huge.log.lines[0];
    if (!clipped) {
      throw new Error("missing log line");
    }
    expect([...clipped.message].length).toBe(2000);
    expect(huge.log.lines[0]?.at).toBe(new Date(now).toISOString());
    expect(huge.log.lines[0]?.dropped).toBeUndefined();

    const shot = applyHarnessFrame(state, { kind: "snapshot", stamp: "20261010T120000Z", bytes: 9 }, now + 2, "kit");
    expect(shot.status).toBe(state.status);
    expect(harnessKind("{\"kind\":\"snapshot\"}")).toBeNull();
    expect(applyHarnessFrame(state, [], now, "kit").status).toBe(state.status);
    expect(applyHarnessFrame(state, { kind: "reply" }, now, "kit").status).toBe(state.status);
  });

  it("keeps the last error-level log line on status until the next harness open", () => {
    const state = { status: noteBrainOpen(emptyStatus(), now), log: emptyLog() };
    const info = applyHarnessFrame(state, { kind: "log", level: "INFO", message: "gantry starting" }, now, "kit");
    expect(info.status.lastError).toBeNull();
    const died = applyHarnessFrame(
      pick(info),
      { kind: "log", level: "ERROR", message: "snapshot restore failed err=\"permission denied\"", at: "2026-10-11T00:46:23Z" },
      now,
      "kit",
    );
    expect(died.status.lastError).toEqual({ message: "snapshot restore failed err=\"permission denied\"", at: "2026-10-11T00:46:23Z" });
    const later = applyHarnessFrame(pick(died), { kind: "log", level: "warn", message: "retrying" }, now, "kit");
    expect(later.status.lastError).toEqual(died.status.lastError);
    expect(applyHarnessFrame(pick(died), { kind: "log", level: "error", message: "" }, now, "kit").status.lastError).toEqual(died.status.lastError);
    expect(noteBrainOpen(later.status, now + 2).lastError).toBeNull();
    expect(parseStatus({ ...later.status, lastError: { message: 1 } })).toEqual(emptyStatus());
    expect(parseStatus(later.status).lastError).toEqual(died.status.lastError);
    const { lastError: _dropped, ...legacy } = later.status;
    expect(parseStatus(legacy).lastError).toBeNull();
  });

  it("keeps a bounded ring and pages with an after cursor", () => {
    let log = emptyLog();
    for (let i = 0; i < LOG_CAP + 1; i++) {
      log = applyHarnessFrame({ status: emptyStatus(), log }, { kind: "log", message: `m${i}` }, now, null).log;
    }
    expect(log.lines).toHaveLength(LOG_CAP);
    expect(log.lines[0]?.seq).toBe(2);
    expect(log.seq).toBe(LOG_CAP + 1);
    const page = pageLog(log, 0, 2);
    expect(page.lines.map((line) => line.seq)).toEqual([2, 3]);
    expect(page.next).toBe(3);
    expect(pageLog(log, log.seq)).toEqual({ lines: [], next: log.seq });
    expect(pageLog(log, 9_999).next).toBe(9_999);
  });

  it("stamps a harness open and parses a stored row", () => {
    const opened = noteBrainOpen({ ...emptyStatus(), perf: { turns: 3, prompt: 1, completion: 1, errors: 0 }, lastError: { message: "x", at: "t" } }, now);
    expect(opened).toMatchObject({ since: now, lastError: null, perf: { turns: 3 } });
    expect(noteBrainOpen(opened, now + 5).perf.turns).toBe(3);
    expect(parseStatus({ harness: "nope" })).toEqual(emptyStatus());
    expect(stateFromPlugins([
      { name: "a", state: "skipped", reason: "no_key" },
      { name: "b", state: "skipped", reason: "error" },
    ])).toBe("error");
    expect(stateFromPlugins([{ name: "garmin", state: "skipped", reason: "disabled" }])).toBe("ready");
    const legacy = parseStatus({
      harness: "disconnected",
      since: 4,
      published: ["math"],
      skipped: [{ name: "strava", reason: "no_key" }, { name: "garmin", reason: "disabled" }],
      lastTurn: 9,
      perf: { turns: 1, prompt: 2, completion: 3, errors: 0 },
    });
    expect(legacy.state).toBe("needs_keys");
    expect(legacy.lastTurnAt).toBe(9);
    expect(legacy.plugins).toEqual([
      { name: "math", state: "ready" },
      { name: "strava", state: "skipped", reason: "no_key" },
      { name: "garmin", state: "skipped", reason: "disabled" },
    ]);
    expect(JSON.stringify(legacy)).not.toMatch(/connected|disconnected/);
    const stored = parseStatus({
      ...opened,
      state: "ready",
      published: ["maps", 1],
      plugins: [{ name: "maps", state: "ready" }, { name: 1 }, { name: "a", state: "skipped", reason: "no_key" }],
    });
    expect(stored.published).toEqual(["maps"]);
    expect(stored.skipped).toEqual([{ name: "a", reason: "no_key" }]);
    expect(parseLog(null)).toEqual(emptyLog());
    expect(parseLog({ seq: 4, lines: [{ seq: 4, at: "t", level: "info", message: "m", dropped: 2 }, { seq: "x" }] }).lines).toEqual([
      { seq: 4, at: "t", level: "info", message: "m", dropped: 2 },
    ]);
    expect(parseLog({ seq: -1, lines: [] })).toEqual(emptyLog());
  });

  it("names a booted harness running and an empty row not started", () => {
    expect(statusLabel("ready")).toBe("running");
    expect(statusLabel("needs_keys")).toBe("running");
    expect(statusLabel("error")).toBe("not started");
    expect(statusLabel("starting")).toBe("not started");
    expect(statusLabel(null)).toBe("not started");
    expect(statusLabel(undefined)).toBe("not started");
  });

  it("prefers enabled for the board pill", () => {
    expect(agentRunLabel({ enabled: false, state: "ready" })).toBe("stopped");
    expect(agentRunLabel({ enabled: false, state: "needs_keys" })).toBe("stopped");
    expect(agentRunLabel({ enabled: true, state: "ready" })).toBe("running");
    expect(agentRunLabel({ enabled: true, state: "starting" })).toBe("not started");
  });

  it("caps a runaway token total", () => {
    const status = { ...emptyStatus(), perf: { turns: 1, prompt: Number.MAX_SAFE_INTEGER, completion: 0, errors: 0 } };
    const next = applyHarnessFrame({ status, log: emptyLog() }, { kind: "perf", tokens: { prompt: 5, completion: 1 }, outcome: "ok" }, now, "kit");
    expect(next.status.perf.prompt).toBe(Number.MAX_SAFE_INTEGER);
    expect(next.status.perf.completion).toBe(1);
    expect(next.status.perf.errors).toBe(0);
  });
});

function pick<T extends { status: { published: string[] }; log: { lines: unknown[]; seq: number } }>(folded: T): { status: T["status"]; log: T["log"] } {
  return { status: folded.status, log: folded.log };
}

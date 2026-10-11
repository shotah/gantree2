import { describe, expect, it } from "vitest";
import {
  applyHarnessFrame,
  emptyLog,
  emptyStatus,
  harnessKind,
  LOG_CAP,
  noteConnected,
  noteDisconnected,
  pageLog,
  parseLog,
  parseStatus,
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
    const status = noteConnected(emptyStatus(), now);
    let state = { status, log: emptyLog() };
    state = pick(applyHarnessFrame(state, { kind: "status", published: [" maps ", 1, ""], skipped: [{ name: "strava", reason: "no_key" }, { name: "" }] }, now, "kit"));
    expect(state.status.published).toEqual(["maps"]);
    expect(state.status.skipped).toEqual([{ name: "strava", reason: "no_key" }]);

    const perf = applyHarnessFrame(state, { kind: "perf", outcome: "error", tokens: { prompt: 10, completion: 2 } }, now + 1, "kit");
    expect(perf.status.perf).toEqual({ turns: 1, prompt: 10, completion: 2, errors: 1 });
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

  it("keeps the last error-level log line on status until the next connect", () => {
    const state = { status: noteConnected(emptyStatus(), now), log: emptyLog() };
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
    const down = noteDisconnected(later.status, now + 1);
    expect(down.lastError).toEqual(died.status.lastError);
    expect(noteConnected(down, now + 2).lastError).toBeNull();
    expect(parseStatus({ ...down, lastError: { message: 1 } })).toEqual(emptyStatus());
    expect(parseStatus(down).lastError).toEqual(died.status.lastError);
    const { lastError: _dropped, ...legacy } = down;
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

  it("resets perf on the first connect and parses stored junk", () => {
    const connected = noteConnected(emptyStatus(), now);
    expect(noteConnected(connected, now + 5)).toBe(connected);
    expect(noteDisconnected(connected, now + 9)).toMatchObject({ harness: "disconnected", since: now + 9, perf: connected.perf });
    expect(parseStatus({ harness: "nope" })).toEqual(emptyStatus());
    const stored = parseStatus({
      ...connected,
      published: ["maps", 1],
      skipped: [{ name: "a", reason: "no_key" }, { name: 1 }],
    });
    expect(stored.published).toEqual(["maps"]);
    expect(stored.skipped).toEqual([{ name: "a", reason: "no_key" }]);
    expect(parseLog(null)).toEqual(emptyLog());
    expect(parseLog({ seq: 4, lines: [{ seq: 4, at: "t", level: "info", message: "m", dropped: 2 }, { seq: "x" }] }).lines).toEqual([
      { seq: 4, at: "t", level: "info", message: "m", dropped: 2 },
    ]);
    expect(parseLog({ seq: -1, lines: [] })).toEqual(emptyLog());
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

import { describe, expect, it } from "vitest";
import { type ToolDef } from "@/brain/core/tools";
import {
  alwaysOn,
  BRIEF_IDLE_MS,
  ENABLE_TOOL_NAME,
  enableHint,
  enableHoldReply,
  enableIndex,
  EnableStore,
  formatIndex,
  formatIndexStatus,
  hasSubprefixes,
  HOLD_BRIEF,
  HOLD_SHORT,
  matches,
  MAX_ENABLE_LIST,
  parseEnableHoldCommand,
  parseForceCsv,
  publishTools,
  runEnableTool,
  SHORT_IDLE_MS,
  SOURCE_AGENT,
  SOURCE_HUMAN,
} from "@/brain/tools/enable";
import { memSql, testClock } from "./fixture";

describe("matches", () => {
  it("is segment-aware", () => {
    const cases: [string, string, boolean][] = [
      ["google__calendar_list_events", "google", true],
      ["google__calendar_list_events", "google__calendar", true],
      ["google__gmail_search_messages", "google__calendar", false],
      ["google__calendar_list_events", "go", false],
      ["google__calendar_list_events", "google__cal", false],
      ["garmin__sleep_get", "garmin__sleep", true],
      ["garmin__sleep_get", "garmin", true],
      ["flights__offers_search", "flights", true],
      ["mcp_enable", "mcp", false],
    ];
    for (const [name, key, want] of cases) {
      expect(matches(name, key), `${name} ${key}`).toBe(want);
    }
  });
});

describe("enableIndex", () => {
  it("adds a family key only when a server has two or more families", () => {
    const defs = [
      { name: "google__calendar_list_events" },
      { name: "google__gmail_search_messages" },
      { name: "garmin__sleep_get" },
      { name: "flights__offers_search" },
      { name: "memory_store" },
    ];
    const got = enableIndex(defs);
    expect(got).toEqual(["flights", "garmin", "google", "google__calendar", "google__gmail"]);
    expect(hasSubprefixes("google", got)).toBe(true);
    expect(hasSubprefixes("flights", got)).toBe(false);
  });
});

describe("alwaysOn", () => {
  it("keeps unprefixed builtins and drops server tools", () => {
    expect(alwaysOn("memory_store")).toBe(true);
    expect(alwaysOn("mcp_enable")).toBe(true);
    expect(alwaysOn("self_note")).toBe(true);
    expect(alwaysOn("web_search")).toBe(true);
    expect(alwaysOn("google__calendar_list_events")).toBe(false);
  });
});

describe("publishTools", () => {
  const defs: ToolDef[] = [
    { name: "memory_store", description: "", inputSchema: {} },
    { name: "mcp_enable", description: "", inputSchema: {} },
    { name: "google__calendar_list_events", description: "", inputSchema: {} },
    { name: "google__gmail_search_messages", description: "", inputSchema: {} },
    { name: "flights__offers_search", description: "", inputSchema: {} },
  ];

  it("keeps builtins, the enable tool, and the enabled family", () => {
    const names = publishTools(defs, [{ prefix: "google__calendar", hold: HOLD_SHORT, source: SOURCE_AGENT, sessionId: "s", lastUsed: 0 }], { prefixes: [] })
      .map((def) => def.name);
    expect(names).toContain("memory_store");
    expect(names).toContain("mcp_enable");
    expect(names).toContain("google__calendar_list_events");
    expect(names.join(",")).not.toContain("gmail");
    expect(names.join(",")).not.toContain("flights");
  });

  it("publishes a force prefix with no session rows", () => {
    const names = publishTools(defs, [], { prefixes: ["flights"] }).map((def) => def.name);
    expect(names).toContain("flights__offers_search");
  });
});

describe("enableHint", () => {
  it("names the longest index key", () => {
    const hint = enableHint("google__calendar_list_events", ["google", "google__calendar"]);
    expect(hint).toContain("mcp_enable");
    expect(hint).toContain("google__calendar");
  });
});

describe("formatIndex", () => {
  it("is byte-stable, sorted, and hides ages until /tools", () => {
    const rows = [
      { sessionId: "s", prefix: "strava", hold: HOLD_SHORT, source: SOURCE_AGENT, lastUsed: 0 },
      { sessionId: "s", prefix: "google__calendar", hold: HOLD_BRIEF, source: SOURCE_AGENT, lastUsed: 0 },
    ];
    const index = ["flights", "google", "google__calendar", "google__gmail", "strava"];
    const force = { prefixes: ["garmin__sleep"] };
    const a = formatIndex(rows, index, force);
    const b = formatIndex(rows, index, force);
    expect(a).toBe(b);
    expect(a).not.toContain("ago");
    expect(a).toContain("Review on vs off");
    expect(a).toContain("listed off");
    const garmin = a.indexOf("garmin__sleep");
    const calendar = a.indexOf("google__calendar");
    const strava = a.indexOf("strava");
    expect(garmin).toBeGreaterThanOrEqual(0);
    expect(garmin).toBeLessThan(calendar);
    expect(calendar).toBeLessThan(strava);
    const flights = a.indexOf("flights");
    const gmail = a.indexOf("google__gmail");
    expect(flights).toBeGreaterThanOrEqual(0);
    expect(gmail).toBeGreaterThan(flights);

    const now = Date.UTC(2026, 7, 17, 12, 0, 0);
    const aged = rows.map((row) => ({ ...row, lastUsed: now - 5 * 60_000 }));
    const status = formatIndexStatus(aged, index, force, now);
    expect(status).toContain("ago");
    expect(status).toContain("strava (short, 5m0s ago)");
    const sample = rows[0];
    if (!sample) {
      throw new Error("missing sample row");
    }
    expect(formatIndexStatus([{ ...sample, lastUsed: now - 90 * 60_000 }], index, { prefixes: [] }, now)).toContain("1h30m0s ago");
    expect(formatIndexStatus([{ ...sample, lastUsed: now - 29_000 }], index, { prefixes: [] }, now)).toContain("0s ago");
    expect(formatIndexStatus([{ ...sample, lastUsed: now - 30_000 }], index, { prefixes: [] }, now)).toContain("1m0s ago");
    expect(formatIndexStatus([{ ...sample, lastUsed: now + 60_000 }], index, { prefixes: [] }, now)).toContain("0s ago");
  });
});

describe("parseForceCsv", () => {
  it("drops blanks", () => {
    expect(parseForceCsv(" garmin , ,flights ")).toEqual(["garmin", "flights"]);
    expect(parseForceCsv("")).toEqual([]);
  });
});

describe("parseEnableHoldCommand", () => {
  it("accepts /brief, /short, and /off", () => {
    expect(parseEnableHoldCommand("/brief@bot flights")).toEqual({ cmd: "/brief", prefix: "flights" });
    expect(parseEnableHoldCommand("/short garmin__sleep")).toEqual({ cmd: "/short", prefix: "garmin__sleep" });
    expect(parseEnableHoldCommand("/off google")).toEqual({ cmd: "/off", prefix: "google" });
    expect(parseEnableHoldCommand("hello")).toBeNull();
    expect(parseEnableHoldCommand("/brief")).toBeNull();
  });
});

describe("EnableStore", () => {
  it("enables, touches the longest prefix, and expires short holds", () => {
    const clock = testClock();
    const store = new EnableStore(memSql(), clock);
    const index = ["google", "google__calendar", "flights"];
    const first = store.enable("telegram:1:1", ["google__calendar", "flights"], HOLD_SHORT, SOURCE_AGENT, index);
    expect(first.landed).toEqual(["google__calendar", "flights"]);
    expect(first.failed).toEqual([]);

    const unknown = store.enable("telegram:1:1", ["nope"], HOLD_SHORT, SOURCE_AGENT, index);
    expect(unknown.failed).toEqual(["nope (unknown prefix)"]);

    store.enable("telegram:1:1", ["google"], HOLD_SHORT, SOURCE_AGENT, index);
    clock.tick(60 * 60 * 1000);
    store.touch("telegram:1:1", "google__calendar_list_events");
    const rows = store.list("telegram:1:1");
    const calendar = rows.find((row) => row.prefix === "google__calendar");
    const server = rows.find((row) => row.prefix === "google");
    expect(calendar?.lastUsed).toBeGreaterThanOrEqual(clock.now() - 1000);
    expect(server?.lastUsed).toBe(clock.now() - 60 * 60 * 1000);

    clock.tick(SHORT_IDLE_MS + 2 * 60 * 60 * 1000);
    expect(store.list("telegram:1:1")).toEqual([]);
    expect(store.list("other")).toEqual([]);
  });

  it("keeps a human source when the agent refreshes the hold", () => {
    const clock = testClock();
    const store = new EnableStore(memSql(), clock);
    const index = ["garmin__sleep"];
    store.enable("s", ["garmin__sleep"], HOLD_SHORT, SOURCE_HUMAN, index);
    const again = store.enable("s", ["garmin__sleep"], HOLD_BRIEF, SOURCE_AGENT, index);
    expect(again.failed).toEqual([]);
    const rows = store.list("s");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe(SOURCE_HUMAN);
    expect(rows[0]?.hold).toBe(HOLD_BRIEF);
  });

  it("drops a brief hold after 6h and keeps it through the afternoon", () => {
    const clock = testClock();
    const store = new EnableStore(memSql(), clock);
    store.enable("s", ["flights"], HOLD_BRIEF, SOURCE_AGENT, ["flights"]);
    clock.tick(5 * 60 * 60 * 1000);
    expect(store.list("s")).toHaveLength(1);
    clock.tick(BRIEF_IDLE_MS + 60_000 - 5 * 60 * 60 * 1000);
    expect(store.list("s")).toEqual([]);
  });

  it("rewrites legacy long holds on open", () => {
    const sql = memSql();
    const clock = testClock();
    const store = new EnableStore(sql, clock);
    sql.exec(
      "INSERT INTO mcp_enable (session_id, prefix, hold, source, last_used) VALUES ('s', 'flights', 'long', 'agent', ?)",
      clock.now(),
    );
    const again = new EnableStore(sql, clock);
    expect(again.list("s")[0]?.hold).toBe(HOLD_SHORT);
    expect(sql.one<{ hold: string }>("SELECT hold FROM mcp_enable WHERE prefix = ?", "flights")?.hold).toBe("short");
    expect(store.list("s")[0]?.hold).toBe(HOLD_SHORT);
  });

  it("rejects more than 8 prefixes and an empty session", () => {
    const store = new EnableStore(memSql(), testClock());
    const prefixes = Array.from({ length: MAX_ENABLE_LIST + 1 }, () => "x");
    expect(() => store.enable("s", prefixes, HOLD_SHORT, SOURCE_AGENT, ["x"])).toThrow(/at most 8/);
    expect(() => store.enable("  ", ["x"], HOLD_SHORT, SOURCE_AGENT, ["x"])).toThrow(/empty session_id/);
  });

  it("turns a prefix off and ignores a touch with no matching row", () => {
    const store = new EnableStore(memSql(), testClock());
    store.enable("s", ["flights"], HOLD_SHORT, SOURCE_AGENT, ["flights"]);
    store.off("s", "flights");
    expect(store.list("s")).toEqual([]);
    expect(() => store.touch("s", "flights__offers_search")).not.toThrow();
  });

  it("records tools migrations", () => {
    const sql = memSql();
    new EnableStore(sql, testClock());
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration ORDER BY id").map((row) => row.id)).toEqual([
      "tools.001",
      "tools.002",
      "tools.003",
    ]);
  });
});

describe("runEnableTool", () => {
  it("reports what landed and what was skipped", () => {
    const store = new EnableStore(memSql(), testClock());
    const index = ["google__calendar", "flights"];
    const ok = runEnableTool(store, { prefixes: ["google__calendar", "flights"] }, "s", index);
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0]).toEqual({
      type: "text",
      text: "enabled google__calendar, flights (short) — schemas on the next model call",
    });
    const mixed = runEnableTool(store, { prefixes: ["google__calendar", "nope"], hold: "brief" }, "s", index);
    expect(mixed.content[0]).toEqual({
      type: "text",
      text: "enabled google__calendar (brief) — schemas on the next model call. skipped: nope (unknown prefix)",
    });
    expect(runEnableTool(store, {}, "s", index).content[0]).toMatchObject({ text: "nothing enabled" });
    expect(runEnableTool(null, { prefixes: ["flights"] }, "s", index).isError).toBe(true);
    expect(runEnableTool(store, { prefixes: ["flights"] }, "", index).isError).toBe(true);
    expect(runEnableTool(store, { prefixes: [1] }, "s", index).isError).toBe(true);
  });

  it("uses the enable tool name", () => {
    expect(ENABLE_TOOL_NAME).toBe("mcp_enable");
  });
});

describe("enableHoldReply", () => {
  it("sets a human hold and turns a prefix off", () => {
    const store = new EnableStore(memSql(), testClock());
    expect(enableHoldReply(null, "s", "/short", "flights", ["flights"])).toContain("dynamic tools are off");
    expect(enableHoldReply(store, "s", "/brief", "flights", ["flights"])).toBe("brief flights");
    expect(store.list("s")[0]?.hold).toBe(HOLD_BRIEF);
    expect(store.list("s")[0]?.source).toBe(SOURCE_HUMAN);
    expect(enableHoldReply(store, "s", "/off", "flights", ["flights"])).toBe("off flights");
    expect(store.list("s")).toEqual([]);
    expect(enableHoldReply(store, "s", "/short", "nope", ["flights"])).toContain("unknown prefix");
  });
});

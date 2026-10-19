import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atLocalTime, localParts } from "@/harness/core/clock";
import { DailyPlannerMarker, JobUserPrefix } from "@/harness/cron/prompts";
import { parseMcpServers } from "@/harness/eval/catalog";
import {
  EVAL_TZ,
  compileGoRegexp,
  evalInboundText,
  expandEvalClock,
  expandEvalIds,
  fixtureDir,
  fixtureProblems,
  loadEvalFixtures,
  shiftLocalDay,
  zonedAddDays,
  type EvalFixture,
} from "@/harness/eval/fixture";

function bare(partial: Partial<EvalFixture> = {}): EvalFixture {
  return {
    name: "bare",
    why: "because",
    inbound: "hi",
    planner: false,
    cron: "",
    surface: "",
    input: "",
    history: [],
    waiting: false,
    memory: [],
    self: "",
    tools: [],
    ledger: [],
    toolsFrom: [],
    force: [],
    now: "",
    expect: {
      toolsCalled: [],
      toolsNotCalled: [],
      order: [],
      parallel: [],
      replyRegex: "",
      replyNot: "",
      react: "",
      memory: [],
      anyOf: [],
    },
    ...partial,
  };
}

describe("eval fixtures", () => {
  const fixtures = loadEvalFixtures();

  it("loads every JSON fixture, each name once, each one well-formed", () => {
    expect(fixtures.length).toBe(31);
    const names = fixtures.map((fx) => fx.name);
    expect(new Set(names).size).toBe(names.length);
    const servers = new Set(parseMcpServers(readFileSync(join(fixtureDir, "mcp.toml"), "utf8")).map((server) => server.name));
    const problems = fixtures.flatMap((fx) => fixtureProblems(fx, servers).map((problem) => `${fx.name}: ${problem}`));
    expect(problems).toEqual([]);
  });

  it("expands clock placeholders in the fixture zone", () => {
    const noon = atLocalTime(Date.parse("2026-09-14T19:00:00Z"), EVAL_TZ, 12, 0);
    const got = expandEvalClock("Sprint is at {{+150m}}; take the scoop at {{+120m}}. Slept {{-30m}}.", noon, EVAL_TZ);
    expect(got).toBe("Sprint is at 2:30PM; take the scoop at 2:00PM. Slept 11:30AM.");
  });

  it("builds planner, cron, and human inbound text", () => {
    const now = Date.parse("2026-09-14T19:00:00Z");
    expect(evalInboundText(bare({ planner: true, inbound: "" }), now)).toContain(DailyPlannerMarker);
    const cron = evalInboundText(bare({ inbound: "", cron: "Daily rental check" }), now);
    expect(cron.startsWith(JobUserPrefix)).toBe(true);
    expect(cron.endsWith("Daily rental check")).toBe(true);
    expect(evalInboundText(bare({ inbound: "hi" }), now)).toBe("hi");
  });

  it("replaces seeded id placeholders and leaves a missing index as 0", () => {
    const got = expandEvalIds(`"id"\\s*:\\s*{{memory:0}} or {{ledger:0}} or {{memory:9}}`, {
      memory: [42],
      ledger: [7],
    });
    expect(got).toBe(`"id"\\s*:\\s*42 or 7 or 0`);
  });

  it("compiles a leading Go (?i) flag", () => {
    expect(compileGoRegexp("(?i)sprint|dentist").test("Sprint planning")).toBe(true);
  });

  it("shifts a local day without moving the wall clock", () => {
    const noon = atLocalTime(Date.parse("2026-09-14T19:00:00Z"), EVAL_TZ, 12, 0);
    expect(shiftLocalDay(noon, EVAL_TZ, -1)).toBe("2026-09-13");
    const back = zonedAddDays(noon, EVAL_TZ, -1);
    const parts = localParts(back, EVAL_TZ);
    expect(parts.day).toBe(13);
    expect(parts.hour === 24 ? 0 : parts.hour).toBe(12);
    expect(parts.minute).toBe(0);
  });
});

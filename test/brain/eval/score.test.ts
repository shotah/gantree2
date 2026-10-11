import { describe, expect, it } from "vitest";
import { emptyOutcome, type EvalOutcome } from "@/brain/eval/expect";
import { type EvalExpect, type EvalFixture } from "@/brain/eval/fixture";
import { scoreFixtures, type MorningRun } from "@/brain/eval/score";

function shape(partial: Partial<EvalExpect> = {}): EvalExpect {
  return {
    toolsCalled: [],
    toolsNotCalled: [],
    order: [],
    replyRegex: "",
    replyNot: "",
    react: "",
    memory: [],
    anyOf: [],
    ...partial,
  };
}

function fixture(name: string, expect: EvalExpect, why = name): EvalFixture {
  return {
    name,
    why,
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
    expect,
  };
}

function passed(partial: Partial<EvalOutcome> = {}): EvalOutcome {
  return {
    ...emptyOutcome(),
    rounds: 2,
    promptTokens: 10700,
    completionTokens: 259,
    calls: [{ name: "cron_schedule", args: "{}", round: 1, result: "ok" }],
    reply: "Scoop is set.",
    rawReply: "Scoop is set.",
    ...partial,
  };
}

function morning(out: EvalOutcome, expect: EvalExpect, extra: Partial<MorningRun> = {}): MorningRun {
  return { out, expect, prevLine: "", differ: false, ...extra };
}

describe("eval scoring", () => {
  it("prints a pass, the fixture mean, and the all-fixtures line", async () => {
    const expectShape = shape();
    const lines: string[] = [];
    const result = await scoreFixtures({
      fixtures: [fixture("scoop_at_2", expectShape, "A 2:00 errand gets one cron.")],
      n: 1,
      only: null,
      verbose: false,
      log: (line) => {
        lines.push(line);
      },
      run: () => Promise.resolve([morning(passed(), expectShape)]),
    });
    expect(result).toEqual({ failed: 0, runs: 1 });
    expect(lines).toContain("run 1/1 ok: 2 rounds, 10.7k prompt / 259 completion tokens — [cron_schedule] → reply");
    expect(lines).toContain("scoop_at_2: 1 runs, mean 2.00 rounds, mean 10.7k prompt / 259 completion tokens per turn");
    expect(lines.at(-1)).toBe("all fixtures: 1 runs, mean 2.00 rounds, mean 10.7k prompt / 259 completion tokens per turn");
  });

  it("lists a failure with the model's reply", async () => {
    const expectShape = shape({ toolsCalled: [{ name: "cron_schedule", argsRegex: "" }] });
    const reply = "Sprint's at 2:30 and the scoop is at 2 — I'll keep an eye on it.";
    const lines: string[] = [];
    const result = await scoreFixtures({
      fixtures: [fixture("scoop_at_2", expectShape)],
      n: 1,
      only: null,
      verbose: false,
      log: (line) => {
        lines.push(line);
      },
      run: () => Promise.resolve([morning(passed({ calls: [], reply, rawReply: reply }), expectShape)]),
    });
    expect(result.failed).toBe(1);
    const fail = lines.find((line) => line.startsWith("run 1/1 FAIL"));
    expect(fail).toContain("expected tool cron_schedule");
    expect(fail).toContain(reply);
  });

  it("notes a round over budget without failing, and counts it", async () => {
    const expectShape = shape({ roundBudget: 1 });
    const lines: string[] = [];
    const result = await scoreFixtures({
      fixtures: [fixture("scoop_at_2", expectShape)],
      n: 1,
      only: null,
      verbose: false,
      log: (line) => {
        lines.push(line);
      },
      run: () => Promise.resolve([morning(passed(), expectShape)]),
    });
    expect(result.failed).toBe(0);
    expect(lines).toContain(
      "run 1/1 ok (over budget: 2 rounds, budget 1): 2 rounds, 10.7k prompt / 259 completion tokens — [cron_schedule] → reply",
    );
    expect(lines.at(-1)).toContain("1 over round budget");
  });

  it("repeats n times, filters by name, and fails an unknown name", async () => {
    const expectShape = shape();
    const lines: string[] = [];
    const both = await scoreFixtures({
      fixtures: [fixture("scoop_at_2", expectShape), fixture("denver_flight", expectShape, "flight")],
      n: 2,
      only: ["scoop_at_2"],
      verbose: false,
      log: (line) => {
        lines.push(line);
      },
      run: () => Promise.resolve([morning(passed(), expectShape)]),
    });
    expect(both).toEqual({ failed: 0, runs: 2 });
    expect(lines.filter((line) => line.startsWith("run "))).toEqual([
      "run 1/2 ok: 2 rounds, 10.7k prompt / 259 completion tokens — [cron_schedule] → reply",
      "run 2/2 ok: 2 rounds, 10.7k prompt / 259 completion tokens — [cron_schedule] → reply",
    ]);
    expect(lines.some((line) => line.startsWith("denver_flight"))).toBe(false);

    const unknown: string[] = [];
    const missed = await scoreFixtures({
      fixtures: [fixture("scoop_at_2", expectShape)],
      n: 1,
      only: ["no_such_fixture"],
      verbose: false,
      log: (line) => {
        unknown.push(line);
      },
      run: () => Promise.resolve([morning(passed(), expectShape)]),
    });
    expect(missed.failed).toBe(1);
    expect(unknown[0]).toBe("unknown fixture no_such_fixture");
    expect(unknown.at(-1)).toBe("all fixtures: no runs");
  });

  it("fails a repeated morning line and a thrown turn", async () => {
    const expectShape = shape();
    const lines: string[] = [];
    const same = await scoreFixtures({
      fixtures: [fixture("two_mornings", expectShape)],
      n: 1,
      only: null,
      verbose: false,
      log: (line) => {
        lines.push(line);
      },
      run: () => Promise.resolve([
        morning(passed({ rawReply: "Quiet morning.\n[wait]", reply: "Quiet morning." }), expectShape, {
          differ: true,
          prevLine: "Quiet morning.",
        }),
      ]),
    });
    expect(same.failed).toBe(1);
    expect(lines.find((line) => line.startsWith("run 1/1 FAIL"))).toContain("same line as the previous morning");

    const thrown: string[] = [];
    const boom = await scoreFixtures({
      fixtures: [fixture("scoop_at_2", expectShape)],
      n: 1,
      only: null,
      verbose: false,
      log: (line) => {
        thrown.push(line);
      },
      run: () => Promise.reject(new Error("not implemented")),
    });
    expect(boom.failed).toBe(1);
    expect(thrown.find((line) => line.startsWith("run 1/1 FAIL"))).toContain("turn error: not implemented");
  });
});

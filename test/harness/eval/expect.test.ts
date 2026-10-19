import { describe, expect, it } from "vitest";
import {
  checkEval,
  describeBatches,
  describeCost,
  emptyOutcome,
  formatTotals,
  jobWithin,
  overBudget,
  sameMorningLine,
  type EvalOutcome,
} from "@/harness/eval/expect";
import { type EvalExpect } from "@/harness/eval/fixture";

function shape(partial: Partial<EvalExpect> = {}): EvalExpect {
  return {
    toolsCalled: [],
    toolsNotCalled: [],
    order: [],
    parallel: [],
    replyRegex: "",
    replyNot: "",
    react: "",
    memory: [],
    anyOf: [],
    ...partial,
  };
}

function outcome(partial: Partial<EvalOutcome> = {}): EvalOutcome {
  return { ...emptyOutcome(), ...partial };
}

describe("eval expectations", () => {
  it("caps matching calls and narrows the count with args", () => {
    const out = outcome({
      calls: [
        { name: "rentals__listings_search", args: `{"neighborhood":"Ballard"}`, round: 1, result: "" },
        { name: "rentals__listings_search", args: `{"neighborhood":"Fremont"}`, round: 1, result: "" },
        { name: "rentals__account_get", args: "{}", round: 1, result: "" },
      ],
    });
    expect(checkEval(out, shape({ toolsCalled: [{ name: "rentals__listings_search", argsRegex: "", maxCalls: 2 }] }))).toEqual([]);
    expect(checkEval(out, shape({ toolsCalled: [{ name: "rentals__listings_search", argsRegex: "", maxCalls: 1 }] }))).toEqual([
      "tool rentals__listings_search called 2 times, max 1",
    ]);
    expect(checkEval(out, shape({
      toolsCalled: [{ name: "rentals__listings_search", argsRegex: "Ballard", maxCalls: 1 }],
    }))).toEqual([]);
  });

  it("flags a dollar figure no tool result or input contained", () => {
    const calls = [{
      name: "flights__offers_search",
      args: "{}",
      round: 1,
      result: `{"offers":[{"price":218},{"price":189}],"usage":{"searches_left":88}}`,
    }];
    const ok = outcome({ reply: "Alaska at $189 or United for $218.00 — both nonstop.", rawReply: "Alaska at $189 or United for $218.00 — both nonstop.", calls });
    expect(checkEval(ok, shape({ pricesFromTools: true }))).toEqual([]);
    const bad = outcome({
      reply: "Sep 25 is cheaper: $139 on Alaska and $ 149 on United; Sep 18 is $189.",
      rawReply: "Sep 25 is cheaper: $139 on Alaska and $ 149 on United; Sep 18 is $189.",
      calls,
    });
    expect(checkEval(bad, shape({ pricesFromTools: true }))).toEqual([
      "invented price $139 (in no tool result or input)",
      "invented price $149 (in no tool result or input)",
    ]);
    const rent = outcome({
      reply: "Two new 2BR under $2,400: 5417 NW 57th St at $2,295/mo",
      rawReply: "Two new 2BR under $2,400: 5417 NW 57th St at $2,295/mo",
      calls: [{ name: "rentals__listings_search", args: "{}", round: 1, result: `{"price":2295}` }],
      given: "under $2400\nunder $2,400/mo by Nov 1\n",
    });
    expect(checkEval(rent, shape({ pricesFromTools: true }))).toEqual([]);
  });

  it("requires parallel tools in one batch round", () => {
    const bothRound1 = outcome({
      calls: [
        { name: "google__calendar_list_events", args: "{}", round: 1, result: "[]" },
        { name: "garmin__sleep_summary", args: "{}", round: 1, result: "" },
      ],
    });
    const want = shape({
      parallel: ["google__calendar_list_events", "garmin__sleep_summary"],
    });
    expect(checkEval(bothRound1, want)).toEqual([]);
    const splitRounds = outcome({
      calls: [
        { name: "google__calendar_list_events", args: "{}", round: 1, result: "[]" },
        { name: "garmin__sleep_summary", args: "{}", round: 2, result: "" },
      ],
    });
    expect(checkEval(splitRounds, want)).toEqual([
      "parallel: google__calendar_list_events round 1, garmin__sleep_summary round 2 \u2014 want one batch",
    ]);
    const bothRound2 = outcome({
      calls: [
        { name: "cron_schedule", args: "{}", round: 1, result: "" },
        { name: "google__calendar_list_events", args: "{}", round: 2, result: "[]" },
        { name: "garmin__sleep_summary", args: "{}", round: 2, result: "" },
      ],
    });
    expect(checkEval(bothRound2, want)).toEqual([]);
    const oneMissing = outcome({
      calls: [{ name: "google__calendar_list_events", args: "{}", round: 1, result: "[]" }],
    });
    expect(checkEval(oneMissing, want)).toEqual(["parallel: garmin__sleep_summary never called"]);
  });

  it("requires call order and never fails a round budget", () => {
    const out = outcome({
      calls: [
        { name: "mcp_enable", args: `{"prefixes":["google"]}`, round: 1, result: "" },
        { name: "google__calendar_list_events", args: "{}", round: 2, result: "[]" },
      ],
      rounds: 2,
      rawReply: "Sprint at 2:30.",
      reply: "Sprint at 2:30.",
    });
    expect(checkEval(out, shape({
      toolsCalled: [
        { name: "mcp_enable", argsRegex: "google" },
        { name: "google__calendar_list_events", argsRegex: "" },
      ],
      order: ["mcp_enable", "google__calendar_list_events"],
      replyRegex: "(?i)sprint|dentist",
    }))).toEqual([]);
    const swapped = outcome({
      calls: [
        { name: "google__calendar_list_events", args: "{}", round: 1, result: "" },
        { name: "mcp_enable", args: `{"prefixes":["google"]}`, round: 1, result: "" },
      ],
      rawReply: "Sprint at 2:30.",
    });
    const fails = checkEval(swapped, shape({
      toolsCalled: [
        { name: "mcp_enable", argsRegex: "google" },
        { name: "google__calendar_list_events", argsRegex: "" },
      ],
      order: ["mcp_enable", "google__calendar_list_events"],
      replyRegex: "(?i)sprint|dentist",
    }));
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatch(/^order:/);
    expect(checkEval(out, shape({ roundBudget: 1 }))).toEqual([]);
    expect(overBudget(out, shape({ roundBudget: 1 }))).toBe("over budget: 2 rounds, budget 1");
    expect(overBudget(out, shape({ roundBudget: 2 }))).toBe("");
  });

  it("checks reactions, silence, questions, and a kernel turn", () => {
    const reacted = outcome({ reaction: "👍", reply: "", rawReply: "[react 👍]" });
    expect(checkEval(reacted, shape({ react: "👍", reactOnly: true }))).toEqual([]);
    const chatty = outcome({ reaction: "👍", reply: "You're welcome!", rawReply: "You're welcome!\n[react 👍]" });
    expect(checkEval(chatty, shape({ react: "*", reactOnly: true }))[0]).toContain("no text");
    expect(checkEval(outcome({ reply: "Anytime.", rawReply: "Anytime." }), shape({ react: "👍" }))[0]).toContain("expected a reaction");
    const asked = outcome({ rawReply: "Lunch or a training block?\n[wait]", reply: "Lunch or a training block?", waiting: true });
    expect(checkEval(asked, shape({ maxQuestions: 1, wait: true }))).toEqual([]);
    expect(checkEval(asked, shape({ maxQuestions: 0 }))[0]).toContain("questions");
    expect(checkEval(outcome({ rawReply: "[silent]", reply: "[silent]", silent: true }), shape({ silent: false }))[0]).toContain("silent=");
    expect(checkEval(outcome({ rounds: 1, silent: true, rawReply: "[silent]" }), shape({ noModelCall: true, silent: true }))[0]).toContain("model rounds");
    expect(checkEval(outcome({ rounds: 0, silent: true }), shape({ noModelCall: true, silent: true }))).toEqual([]);
  });

  it("accepts any memory kind when the expect leaves kind blank", () => {
    const out = outcome({
      memoryHas: (kind, subject) => kind === "fact" && subject === "pref/calendar",
    });
    expect(checkEval(out, shape({ memory: [{ kind: "", subject: "pref/calendar" }] }))).toEqual([]);
    expect(checkEval(out, shape({ memory: [{ kind: "preference", subject: "pref/calendar" }] }))[0]).toContain("expected memory row");
  });

  it("grounds aim_log in the turn and ignores follow-up cron jobs", () => {
    const grounded = outcome({
      given: "Garmin: no activities\n",
      calls: [{ name: "aim_log", args: `{"what":"Garmin: no activities","note":"asked"}`, round: 2, result: "" }],
    });
    expect(checkEval(grounded, shape({ evidenceFromTurn: true }))).toEqual([]);
    const loose = outcome({
      given: "hello\n",
      calls: [{ name: "aim_log", args: `{"what":"invented a marathon"}`, round: 1, result: "" }],
    });
    expect(checkEval(loose, shape({ evidenceFromTurn: true }))[0]).toContain("not grounded");
    const started = 1_700_000_000_000;
    const follow = outcome({
      started,
      jobs: [{ kind: "followup", nextRunAt: started + 120 * 60_000 }],
    });
    expect(jobWithin(follow, { afterMin: 100, beforeMin: 140 })).toBe(false);
    expect(checkEval(follow, shape({ cronWithin: { afterMin: 100, beforeMin: 140 } }))[0]).toContain("no cron job");
    const once = outcome({
      started,
      jobs: [{ kind: "once", nextRunAt: started + 120 * 60_000 }],
    });
    expect(checkEval(once, shape({ cronWithin: { afterMin: 100, beforeMin: 140 } }))).toEqual([]);
  });

  it("lists an any_of miss and describes cost", () => {
    const out = outcome({ reply: "Got it.", rawReply: "Got it.", rounds: 1 });
    const fails = checkEval(out, shape({
      replyNot: "(?i)^\\s*(got it)[.!]*\\s*$",
      anyOf: [
        { ...shape(), toolsCalled: [{ name: "cron_schedule", argsRegex: "" }] },
        { ...shape(), replyRegex: "(?i)ping you" },
      ],
    }));
    expect(fails[0]).toContain("should not match");
    expect(fails[1]).toContain("none of any_of held");
    expect(describeBatches(outcome({
      rounds: 2,
      calls: [{ name: "cron_schedule", args: "{}", round: 1, result: "" }],
    }))).toBe("[cron_schedule] → reply");
    expect(describeCost(outcome({ rounds: 2, promptTokens: 10700, completionTokens: 259 }))).toBe(
      "2 rounds, 10.7k prompt / 259 completion tokens",
    );
    expect(formatTotals({ runs: 3, rounds: 6, prompt: 32100, completion: 777, over: 1 })).toBe(
      "3 runs, mean 2.00 rounds, mean 10.7k prompt / 259 completion tokens per turn, 1 over round budget",
    );
    expect(sameMorningLine("Quiet morning.\n[wait]", "  quiet   morning. ")).toBe(true);
  });
});

/**
 * The live loop's scoring, split from the model so a scripted run can pin
 * the lines. Same words as `TestEval_Live`: per-run pass/fail, the reply
 * on a failure, per-fixture means, then `all fixtures:`.
 */
import {
  addTotals,
  checkEval,
  describeBatches,
  describeCost,
  describeEval,
  emptyOutcome,
  emptyTotals,
  formatTotals,
  mergeTotals,
  morningReply,
  overBudget,
  sameMorningLine,
  type EvalOutcome,
} from "./expect";
import type { EvalExpect, EvalFixture } from "./fixture";
import type { MorningRun } from "./run";

export type { MorningRun };

export type ScoreOptions = {
  fixtures: readonly EvalFixture[];
  /** Runs per fixture. Every run must pass. */
  n: number;
  /** Fixture `name`s. Null runs every fixture. */
  only: readonly string[] | null;
  verbose: boolean;
  log: (line: string) => void;
  run: (fx: EvalFixture) => Promise<MorningRun[]>;
};

export async function scoreFixtures(opts: ScoreOptions): Promise<{ failed: number; runs: number }> {
  let failed = 0;
  if (opts.only) {
    const known = new Set(opts.fixtures.map((fx) => fx.name));
    for (const name of opts.only) {
      if (!known.has(name)) {
        opts.log(`unknown fixture ${name}`);
        failed += 1;
      }
    }
  }
  const total = emptyTotals();
  for (const fx of opts.fixtures) {
    if (opts.only && !opts.only.includes(fx.name)) {
      continue;
    }
    opts.log(fx.why);
    const sub = emptyTotals();
    for (let i = 1; i <= opts.n; i++) {
      const mornings = await oneRun(opts, fx);
      const fails: string[] = [];
      let last: EvalOutcome = mornings[0]?.out ?? emptyOutcome();
      for (const morning of mornings) {
        last = morning.out;
        if (morning.error) {
          fails.push(`turn error: ${morning.error}`);
        }
        fails.push(...checkEval(morning.out, morning.expect));
        if (morning.differ && sameMorningLine(morning.prevLine, morningReply(morning.out))) {
          fails.push("same line as the previous morning");
        }
        addTotals(sub, morning.out, overBudget(morning.out, morning.expect) !== "");
      }
      if (fails.length > 0) {
        failed += 1;
        opts.log(`run ${String(i)}/${String(opts.n)} FAIL: ${fails.join("; ")}\n${describeEval(last)}`);
        continue;
      }
      const over = overBudget(last, fx.expect);
      const note = over === "" ? "" : ` (${over})`;
      opts.log(`run ${String(i)}/${String(opts.n)} ok${note}: ${describeCost(last)} — ${describeBatches(last)}`);
      if (opts.verbose) {
        for (const morning of mornings) {
          opts.log(describeEval(morning.out));
        }
      }
    }
    opts.log(`${fx.name}: ${formatTotals(sub)}`);
    mergeTotals(total, sub);
  }
  opts.log(`all fixtures: ${formatTotals(total)}`);
  return { failed, runs: total.runs };
}

async function oneRun(opts: ScoreOptions, fx: EvalFixture): Promise<MorningRun[]> {
  try {
    return await opts.run(fx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [failedMorning(fx.expect, message)];
  }
}

function failedMorning(expect: EvalExpect, message: string): MorningRun {
  return { out: emptyOutcome(message), expect, prevLine: "", differ: false, error: message };
}

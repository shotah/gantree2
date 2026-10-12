/**
 * Shape checks for one eval turn. Ported from `checkEval` in
 * `harness/internal/agent/eval_harness_test.go`. A failed field is one
 * line. Empty means the turn passed. `round_budget` is never a failure;
 * {@link overBudget} is the note printed beside a pass.
 */
import { KindFollowUp } from "@/harness/cron/constants";
import { isSilentReply } from "@/harness/cron/silent";
import { stripWaitTokens } from "@/harness/cron/wait";
import {
  compileGoRegexp,
  expandEvalExpect,
  type EvalCallExpect,
  type EvalExpect,
  type EvalWindow,
} from "./fixture";

export type EvalCall = {
  name: string;
  /** JSON object text, as the model sent it. */
  args: string;
  /** 1-based completer round that requested the call. */
  round: number;
  /** Tool text. Empty when the call errored. */
  result: string;
};

export type EvalJob = { kind: string; nextRunAt: number };

export type EvalOutcome = {
  calls: EvalCall[];
  /** Reply with wait/react tokens stripped — what Handle returned. */
  reply: string;
  /** Reply before stripping, when the loop still had the tokens. */
  rawReply: string;
  reaction: string;
  waiting: boolean;
  silent: boolean;
  jobs: EvalJob[];
  /** Epoch ms the turn started. Cron windows are measured from here. */
  started: number;
  rounds: number;
  promptTokens: number;
  completionTokens: number;
  /** Turn text, SELF, seeded memory, history. A restated budget is not invented. */
  given: string;
  ledgerIds: number[];
  memoryIds: number[];
  /** Live row with this kind and subject. Empty kind is not consulted here. */
  memoryHas: (kind: string, subject: string) => boolean;
};

export function emptyOutcome(text = ""): EvalOutcome {
  return {
    calls: [],
    reply: "",
    rawReply: text,
    reaction: "",
    waiting: false,
    silent: false,
    jobs: [],
    started: 0,
    rounds: 0,
    promptTokens: 0,
    completionTokens: 0,
    given: "",
    ledgerIds: [],
    memoryIds: [],
    memoryHas: () => false,
  };
}

const KINDS_ANY = ["preference", "fact", "insight"];

const PRICE_RE = /\$\s?(\d[\d,]*\.\d+|\d[\d,]*)/g;

const TOKEN_RE = /[a-z0-9]{4,}/g;

export function checkEval(out: EvalOutcome, want: EvalExpect): string[] {
  const expanded = expandEvalExpect(structuredClone(want), { ledger: out.ledgerIds, memory: out.memoryIds });
  const fails: string[] = [];
  const reply = out.rawReply !== "" ? out.rawReply : out.reply;

  for (const call of expanded.toolsCalled) {
    if (!calledMatching(out.calls, call)) {
      fails.push(`expected tool ${call.name}${argsNote(call.argsRegex)}`);
      continue;
    }
    if (call.maxCalls !== undefined) {
      const n = countMatching(out.calls, call);
      if (n > call.maxCalls) {
        fails.push(`tool ${call.name} called ${String(n)} times, max ${String(call.maxCalls)}`);
      }
    }
  }
  for (const name of expanded.toolsNotCalled) {
    if (calledMatching(out.calls, { name, argsRegex: "" })) {
      fails.push(`unexpected tool ${name}`);
    }
  }
  if (expanded.order.length > 1) {
    let last = -1;
    for (const name of expanded.order) {
      const index = firstCall(out.calls, name);
      if (index < 0) {
        fails.push(`order: ${name} never called`);
        break;
      }
      if (index <= last) {
        fails.push(`order: ${name} before ${expanded.order.join(" → ")}`);
        break;
      }
      last = index;
    }
  }
  if (expanded.replyRegex !== "" && !compileGoRegexp(expanded.replyRegex).test(reply)) {
    fails.push(`reply should match /${expanded.replyRegex}/`);
  }
  if (expanded.replyNot !== "" && compileGoRegexp(expanded.replyNot).test(reply)) {
    fails.push(`reply should not match /${expanded.replyNot}/`);
  }
  if (expanded.maxQuestions !== undefined) {
    const n = countChar(reply, "?") + countChar(reply, "？");
    if (n > expanded.maxQuestions) {
      fails.push(`${String(n)} questions, max ${String(expanded.maxQuestions)}`);
    }
  }
  if (expanded.wait !== undefined && out.waiting !== expanded.wait) {
    fails.push(`waiting_for_reply=${String(out.waiting)}, want ${String(expanded.wait)}`);
  }
  if (expanded.silent !== undefined && out.silent !== expanded.silent) {
    fails.push(`silent=${String(out.silent)}, want ${String(expanded.silent)}`);
  }
  if (expanded.react !== "") {
    if (out.reaction === "") {
      fails.push("expected a reaction, got none");
    } else if (expanded.react !== "*" && out.reaction !== expanded.react) {
      fails.push(`reaction ${out.reaction}, want ${expanded.react}`);
    }
  }
  if (expanded.reactOnly === true && (out.reaction === "" || out.reply.trim() !== "")) {
    fails.push(`want a reaction and no text, got reaction=${JSON.stringify(out.reaction)} text=${JSON.stringify(out.reply)}`);
  }
  if (expanded.noModelCall === true && out.rounds > 0) {
    fails.push(`${String(out.rounds)} model rounds, want the kernel to settle it without one`);
  }
  if (expanded.pricesFromTools === true) {
    for (const price of inventedPrices(reply, out)) {
      fails.push(`invented price $${price} (in no tool result or input)`);
    }
  }
  if (expanded.evidenceFromTurn === true) {
    fails.push(...ungroundedAimLogs(out));
  }
  for (const row of expanded.memory) {
    if (!memoryRowExists(out, row.kind, row.subject)) {
      fails.push(`expected memory row ${row.kind} ${row.subject}`);
    }
  }
  if (expanded.cronWithin && !jobWithin(out, expanded.cronWithin)) {
    const window = expanded.cronWithin;
    fails.push(`no cron job ${String(window.afterMin)}–${String(window.beforeMin)} min out (have ${describeJobs(out)})`);
  }
  if (expanded.anyOf.length > 0) {
    const alts: string[] = [];
    for (let i = 0; i < expanded.anyOf.length; i++) {
      const alt = expanded.anyOf[i];
      if (!alt) {
        continue;
      }
      const sub = checkEval(out, alt);
      if (sub.length === 0) {
        alts.length = 0;
        break;
      }
      alts.push(`alt ${String(i + 1)}: ${sub.join("; ")}`);
    }
    if (alts.length > 0) {
      fails.push(`none of any_of held — ${alts.join(" | ")}`);
    }
  }
  return fails;
}

function memoryRowExists(out: EvalOutcome, kind: string, subject: string): boolean {
  const kinds = kind === "" ? KINDS_ANY : [kind];
  return kinds.some((item) => out.memoryHas(item, subject));
}

export function overBudget(out: EvalOutcome, want: EvalExpect): string {
  if (want.roundBudget === undefined || out.rounds <= want.roundBudget) {
    return "";
  }
  return `over budget: ${String(out.rounds)} rounds, budget ${String(want.roundBudget)}`;
}

export function describeBatches(out: EvalOutcome): string {
  const parts: string[] = [];
  for (let round = 1; round <= out.rounds; round++) {
    const names = out.calls.filter((call) => call.round === round).map((call) => call.name);
    if (names.length > 0) {
      parts.push(`[${names.join(" ")}]`);
    }
  }
  parts.push("reply");
  return parts.join(" → ");
}

export function describeCost(out: EvalOutcome): string {
  if (out.promptTokens === 0) {
    return `${String(out.rounds)} rounds`;
  }
  const prompt = (out.promptTokens / 1000).toFixed(1);
  return `${String(out.rounds)} rounds, ${prompt}k prompt / ${String(out.completionTokens)} completion tokens`;
}

export function describeJobs(out: EvalOutcome): string {
  if (out.jobs.length === 0) {
    return "none";
  }
  return out.jobs.map((job) => {
    const minutes = Math.trunc((job.nextRunAt - out.started) / 60_000);
    return `${job.kind}@+${String(minutes)}m`;
  }).join(", ");
}

export function describeEval(out: EvalOutcome): string {
  const lines = ["--- tool calls ---"];
  if (out.calls.length === 0) {
    lines.push("(none)");
  }
  for (const call of out.calls) {
    lines.push(`r${String(call.round)} ${call.name} ${call.args}`);
  }
  lines.push(`--- ${describeCost(out)}: ${describeBatches(out)} ---`);
  lines.push(`--- waiting=${String(out.waiting)} silent=${String(out.silent)} reaction=${JSON.stringify(out.reaction)} jobs=${describeJobs(out)} ---`);
  lines.push("--- reply ---");
  lines.push(out.rawReply !== "" ? out.rawReply : out.reply);
  return `${lines.join("\n")}\n`;
}

export function sameMorningLine(a: string, b: string): boolean {
  return morningLine(a) === morningLine(b);
}

export function morningReply(out: EvalOutcome): string {
  if (out.rawReply.trim() !== "") {
    return out.rawReply;
  }
  return out.reply;
}

export function morningLine(text: string): string {
  let line = stripWaitTokens(text);
  const cut = line.indexOf("\n\n— tools:");
  if (cut >= 0) {
    line = line.slice(0, cut);
  }
  return line.toLowerCase().trim().split(/\s+/u).filter((part) => part !== "").join(" ");
}

export function jobWithin(out: EvalOutcome, window: EvalWindow): boolean {
  for (const job of out.jobs) {
    if (job.kind === KindFollowUp) {
      continue;
    }
    const minutes = (job.nextRunAt - out.started) / 60_000;
    if (minutes >= window.afterMin && minutes <= window.beforeMin) {
      return true;
    }
  }
  return false;
}

export type EvalTotals = {
  runs: number;
  rounds: number;
  prompt: number;
  completion: number;
  over: number;
};

export function emptyTotals(): EvalTotals {
  return { runs: 0, rounds: 0, prompt: 0, completion: 0, over: 0 };
}

export function addTotals(into: EvalTotals, out: EvalOutcome, over: boolean): void {
  into.runs += 1;
  into.rounds += out.rounds;
  into.prompt += out.promptTokens;
  into.completion += out.completionTokens;
  if (over) {
    into.over += 1;
  }
}

export function mergeTotals(into: EvalTotals, other: EvalTotals): void {
  into.runs += other.runs;
  into.rounds += other.rounds;
  into.prompt += other.prompt;
  into.completion += other.completion;
  into.over += other.over;
}

export function formatTotals(totals: EvalTotals): string {
  if (totals.runs === 0) {
    return "no runs";
  }
  const n = totals.runs;
  const rounds = (totals.rounds / n).toFixed(2);
  const prompt = (totals.prompt / n / 1000).toFixed(1);
  const completion = (totals.completion / n).toFixed(0);
  let line = `${String(n)} runs, mean ${rounds} rounds, mean ${prompt}k prompt / ${completion} completion tokens per turn`;
  if (totals.over > 0) {
    line += `, ${String(totals.over)} over round budget`;
  }
  return line;
}

function calledMatching(calls: readonly EvalCall[], expect: EvalCallExpect): boolean {
  return countMatching(calls, expect) > 0;
}

function countMatching(calls: readonly EvalCall[], expect: EvalCallExpect): number {
  const re = expect.argsRegex === "" ? null : compileGoRegexp(expect.argsRegex);
  let n = 0;
  for (const call of calls) {
    if (call.name !== expect.name) {
      continue;
    }
    if (re === null || re.test(call.args)) {
      n += 1;
    }
  }
  return n;
}

function firstCall(calls: readonly EvalCall[], name: string): number {
  return calls.findIndex((call) => call.name === name);
}

function argsNote(pattern: string): string {
  return pattern === "" ? "" : ` with args /${pattern}/`;
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const item of text) {
    if (item === ch) {
      n += 1;
    }
  }
  return n;
}

function inventedPrices(reply: string, out: EvalOutcome): string[] {
  let haystack = "";
  for (const call of out.calls) {
    haystack += `${call.result.replaceAll(",", "")}\n`;
  }
  haystack += out.given.replaceAll(",", "");
  const invented: string[] = [];
  const seen = new Set<string>();
  for (const match of reply.matchAll(PRICE_RE)) {
    const raw = match[1] ?? "";
    const digits = trimPrice(raw.replaceAll(",", ""));
    if (raw === "" || seen.has(digits) || haystack.includes(digits)) {
      continue;
    }
    seen.add(digits);
    invented.push(raw);
  }
  return invented;
}

function trimPrice(digits: string): string {
  if (digits.endsWith(".00")) {
    return digits.slice(0, -3);
  }
  if (digits.endsWith(".0")) {
    return digits.slice(0, -2);
  }
  return digits;
}

function ungroundedAimLogs(out: EvalOutcome): string[] {
  let hay = out.given.toLowerCase();
  for (const call of out.calls) {
    hay += `\n${call.result.toLowerCase()}`;
  }
  const fails: string[] = [];
  let saw = false;
  for (const call of out.calls) {
    if (call.name !== "aim_log") {
      continue;
    }
    saw = true;
    const what = aimLogWhat(call.args);
    if (!sharesEvidence(what, hay)) {
      fails.push(`aim_log what not grounded in this turn: ${what}`);
    }
  }
  if (!saw) {
    fails.push("evidence_from_turn: no aim_log");
  }
  return fails;
}

function aimLogWhat(args: string): string {
  try {
    const body: unknown = JSON.parse(args);
    if (body !== null && typeof body === "object" && "what" in body) {
      const what = body.what;
      if (typeof what === "string") {
        return what.trim();
      }
    }
  } catch {
    // The args were not JSON; the whole string is the claim.
  }
  return args.trim();
}

function sharesEvidence(what: string, hay: string): boolean {
  const text = what.toLowerCase().trim();
  if (text === "") {
    return false;
  }
  const tokens = text.match(TOKEN_RE) ?? [];
  let long = false;
  for (const token of tokens) {
    if (token.length < 4) {
      continue;
    }
    long = true;
    if (hay.includes(token)) {
      return true;
    }
  }
  if (!long) {
    return hay.includes(text);
  }
  return false;
}

export function silentFromReply(reply: string, raw: string, reaction: string): boolean {
  return (reply.trim() === "" && reaction === "") || isSilentReply(raw);
}

/** Visible reply: wait and react tokens removed, matching Handle's return. */
export function presentReply(raw: string): string {
  return stripWaitTokens(raw);
}

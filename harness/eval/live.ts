/**
 * Live entry. `npm run eval` loads `.dev.vars` and runs this under Vitest.
 * `EVAL_N` is runs per fixture (default 3). `EVAL_ONLY` is a comma-separated
 * list of fixture `name`s. `EVAL_V=1` prints passing runs too.
 * `EVAL_PERSONA` is a bake-off file instead of the shipped seed.
 * Values of `LLM_*` are never written to the log.
 */
import { loadEvalFixtures, defaultPersonaPath } from "./fixture";
import { evalPersonaLabel } from "./seed";
import { runFixture } from "./run";
import { scoreFixtures } from "./score";

export function liveConfigured(): boolean {
  return Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

export function evalRuns(): number {
  const raw = process.env.EVAL_N ?? "3";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("EVAL_N must be a positive integer");
  }
  return n;
}

export function evalOnly(): string[] | null {
  const raw = (process.env.EVAL_ONLY ?? "").trim();
  if (raw === "") {
    return null;
  }
  const names = raw.split(",").map((name) => name.trim()).filter((name) => name !== "");
  return names.length === 0 ? null : names;
}

export async function runLiveEval(log: (line: string) => void): Promise<number> {
  const baseUrl = process.env.LLM_BASE_URL ?? "";
  const apiKey = process.env.LLM_API_KEY ?? "";
  const model = process.env.LLM_MODEL ?? "";
  if (baseUrl === "" || apiKey === "" || model === "") {
    throw new Error("LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL are required");
  }
  const personaPath = process.env.EVAL_PERSONA || defaultPersonaPath;
  const verbose = process.env.EVAL_V === "1" || process.env.EVAL_V === "true";
  const safe = (line: string) => {
    log(redact(line, [apiKey, baseUrl]));
  };
  safe(`live eval: ${String(evalRuns())} run(s) per fixture; persona ${evalPersonaLabel(personaPath)}`);
  const { failed } = await scoreFixtures({
    fixtures: loadEvalFixtures(),
    n: evalRuns(),
    only: evalOnly(),
    verbose,
    log: safe,
    run: (fx) => runFixture(fx, { baseUrl, apiKey, model, personaPath }),
  });
  return failed;
}

function redact(line: string, secrets: readonly string[]): string {
  let out = line;
  for (const secret of secrets) {
    if (secret.length < 8) {
      continue;
    }
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

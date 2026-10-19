# Eval setup

> Why it exists: the persona seed is a behavior contract, and a rule
> that holds two runs in three is a rule the seed is not carrying.
> Fixtures: `harness/eval/fixtures/` (same JSON the Go harness used).

Three values, one file locally and repository secrets in CI. The eval
replays each fixture against a live model with the shipped persona seed.
Tool results stay canned. Where a fixture sets `tools_from`, the runner
reads that plugin's in-process catalog (`harness/plugins`) filtered by
`harness/eval/fixtures/mcp.toml`; it does not call the tool.

| Value | Local | GitHub |
| --- | --- | --- |
| `LLM_BASE_URL` | `.dev.vars` | Repository **secret** |
| `LLM_MODEL` | `.dev.vars` | Repository **secret** |
| `LLM_API_KEY` | `.dev.vars` | Repository **secret** |

`.dev.vars` is the Worker's local env file. It is not committed. `npm run
eval` loads it dotenv-style and does not print the values. A variable
already set in the environment wins, so CI secrets are left alone.

## 1. Local

1. Put the three lines in `.dev.vars` (create the file if it is not
   there):

   ```sh
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
   LLM_API_KEY=your-key
   LLM_MODEL=gemini-3.8-flash
   ```

   Use the model you ship with — the eval is a reading of the seed on
   *that* model, not a model benchmark.

2. Run it:

   ```sh
   npm run eval
   ```

   That loads `.dev.vars` and runs Vitest with `vitest.eval.config.ts`
   (`test/harness/eval/**`). The live test is `TestEval_Live`'s successor.
   A turn is slow on a Flash-class model; thirty fixtures × 3 runs can
   take the better part of an hour. The Vitest timeout is 120 minutes.

   Without the three values the live test skips and the process still
   exits 0:

   ```text
   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL required; put them in .dev.vars and run npm run eval
   ```

   The runner's unit tests (fixture loader, assertions, canned plugins)
   do not need a key. They run under `npm test`. The live file is
   excluded there.

3. Narrow it while you tune:

   ```sh
   EVAL_ONLY=scoop_at_2 npm run eval
   EVAL_N=10 npm run eval
   EVAL_N=3 EVAL_ONLY=no_aims_one_question,planner_gym_no_workout npm run eval
   ```

   `EVAL_ONLY` takes fixture `name`s (the JSON field, not the file
   name), comma-separated. `EVAL_N` is runs per fixture (default 3).
   `EVAL_V=1` prints every call with its args and the reply for passing
   runs too. `EVAL_PERSONA=path` loads that file instead of the shipped
   seed — see the bake-off below. An unknown name is a failure, so a
   typo does not go green.

   Every passing run prints its cost and shape:

   ```text
   run 1/3 ok: 2 rounds, 10.7k prompt / 259 completion tokens — [cron_schedule memory_store google__calendar_create_events] → reply
   scoop_at_2: 3 runs, mean 2.00 rounds, mean 10.7k prompt / 259 completion tokens per turn
   ...
   all fixtures: 21 runs, mean 2.17 rounds, mean 11.3k prompt / 149 completion tokens per turn
   ```

   Rounds are Completer calls for the turn; the last one is the reply,
   so one tool batch plus the answer is 2. Brackets are the calls that
   went out **in one batch** — the parallel tool calls the Go loop is
   good at; each `→` is a serial round. Tokens are the provider's
   native usage summed over rounds (0 when it omits them).

   The script is Node. Set the three variables in the environment (or
   in `.dev.vars`) and run `npm run eval`.

## 2. GitHub

The release gate reads all three from **secrets**. The workflow checks
that each one is set and, if any is missing, prints a notice and
succeeds without running the model. It does not print the values.

**Settings → Secrets and variables → Actions → Secrets**

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`

Or with the `gh` CLI from the repo:

```sh
gh secret set LLM_API_KEY
gh secret set LLM_BASE_URL --body 'https://generativelanguage.googleapis.com/v1beta/openai'
gh secret set LLM_MODEL --body 'gemini-3.8-flash'
```

Two workflows read them:

- **`eval.yml`** — *Actions → eval → Run workflow*. Inputs: `runs`
  (default 3) and `only` (a fixture name, blank = all). By hand:

  ```sh
  gh workflow run eval.yml -f runs=5 -f only=scoop_at_2
  ```

- **`release.yml`** — does not call `eval.yml` unless the tag was cut
  with `npm run release -- --eval` (`eval: force` in the tag message).
  It does not `needs` the eval job.

Without any of the three secrets the eval job skips and stays green, so
a fork with no key still releases. `ci.yml` does not call the eval.
The free goldens and the coverage floors are the PR gate. The live
eval is the hand run, or the release you cut with `--eval`.

## 3. Reading a failure

Every failed run prints what the model did, then the reply:

```text
run 2/3 FAIL: expected tool cron_schedule; waiting_for_reply=false, want true
--- tool calls ---
google__calendar_list_events {}
--- waiting=false silent=false jobs=none ---
--- reply ---
Sprint's at 2:30 and the scoop is at 2 — I'll keep an eye on it.
```

| Failure line | Means |
| --- | --- |
| `expected tool X` | The recorder never saw `X`. A call the agent **blocked** (prefix off, never `mcp_enable`d) also never reaches the recorder — that is a real miss, not a harness gap. |
| `expected tool X with args /re/` | `X` was called, but no call's JSON args matched. |
| `tool X called N times, max M` | Spend discipline on a metered API. Two `offers_search` for two possible Fridays is fine; a third byte-identical to the first is the model re-asking a question it already had answered. |
| `invented price $N (in no tool result or input)` | A figure in the reply that no tool result and no seeded input contained. |
| `fixture tool X is not in the live S catalog (have …)` | Drift: the baked plugin no longer publishes that name. Fails before any model call. |
| `order: X before …` | Both called, wrong order (e.g. the tool before `mcp_enable`). |
| `parallel: X never called` | A name in `expect.parallel` never reached the recorder. |
| `parallel: X round N, Y round M — want one batch` | Both called, but not in the same Completer round — they must share one batch; a later round is fine when those names are together on it. |
| `reply should match /re/` · `should not match` | Shape of the reply — a `?`, a bare "got it". Never a sentence. |
| `N questions, max M` | Counted `?` in the reply. |
| `waiting_for_reply=false, want true` | The model asked but did not put `[wait]` on its own line. |
| `silent=true, want false` | `[silent]` (or an empty reply with no reaction) where a nudge was owed. |
| `expected a reaction, got none` · `reaction X, want Y` | No `[react …]` in the reply, or the wrong emoji (`react: "*"` is any). |
| `want a reaction and no text` | `react_only`: the model reacted and also wrote. |
| `N model rounds, want the kernel to settle it` | `no_model_call`: an idle 👍 reached the model — the kernel triage should have recorded it for free. |
| `expected memory row kind subject` | No live `memory_store` row with that subject after the turn. |
| `no cron job A–B min out (have …)` | Nothing on the board in the window; `followup`-kind wait pokes do not count. |
| `none of any_of held — alt 1: … \| alt 2: …` | Every alternative failed; each is listed with its own reason. |

A rule that holds two runs in three is a rule the persona is not
carrying — that is why every run must pass.

One line is **not** a failure. `run 2/3 ok (over budget: 4 rounds,
budget 3)` means the turn passed and took more Completer rounds than the
fixture's `round_budget`. The gate is on missing work; a model that does
something extra is not wrong, so the budget is reported beside the pass
and summed at the end, never failed. Read it as a trend across runs: a
fixture that is always over budget has a sentence in the seed costing a
round for nothing; one run in five is the model being thorough.

## 4. Tuning

Two kinds of red:

- **The model is right and the fixture is wrong.** It scheduled the
  scoop at +118 minutes and the window was 120–140; it said "buzz you"
  and the regex only knew "ping". Fix the JSON. Widen the window, add
  the word, add an `any_of` alternative.
- **The persona lost a rule.** It said "nothing today" and stopped; it
  narrated a reminder and set no cron; it asked three questions. Do not
  loosen the fixture. Put the line back in the seed, run `EVAL_ONLY`
  on that fixture until it holds, then the whole set.

Regexes are Go `regexp` (RE2): `(?i)` for case-insensitive, no
lookaround. The runner strips a leading `(?i)` and sets the JavaScript
`i` flag. Fixtures are validated by the runner's unit tests before any
model call:

```sh
npm test
```

### One seed

The persona seed the eval fills in (Kit, Sam, Seattle) is
`app/components/agents/personaTemplate.ts` — the text settings gives a
new agent. While `harness/examples/persona/PERSONA.example.md` is still
on disk, the eval reads that file instead. `EVAL_PERSONA` is a bake-off
file and does not fall back.

### The bake-off

The same run is how a persona edit earns its place. Read the shapes
first: a `→` inside a run that the rule did not need is the thing to
cut, and it usually traces to one sentence. Then:

```sh
# edit a copy of the template (or the harness example, if it is still there)
EVAL_N=5 npm run eval                                          # seed: the number to beat
EVAL_N=5 EVAL_PERSONA=/tmp/candidate.md npm run eval           # candidate
```

Compare the two `all fixtures:` lines and the per-fixture means. A
candidate wins when every run still passes and rounds or tokens fall;
n=3 is too noisy to call a 0.2-round difference, use 5 or more. When it
wins, copy it over the seed and lower `round_budget` on the fixtures
that moved so the next regression shows up as a run of over-budget
notes.

What a bake-off is not for: cutting the work. A round worth removing is
one in which the model did nothing new. A candidate that passes with
fewer rounds because it searches less, stores less, or stops at "let me
know when" is a loss, and the completion fixtures are there to fail it.
Likewise `LLM_REASONING_EFFORT`: lower is cheaper because the model
plans less; that is the trade this product does not make.

## 5. Adding a fixture

Copy the nearest file under `harness/eval/fixtures/` and edit. The JSON
shape is the Go fixture format; field names stay snake_case.

| Field | What |
| --- | --- |
| `name`, `why` | `name` is what `EVAL_ONLY` matches; `why` is the rule in one sentence, printed at the top of the run. |
| `inbound` | The human's text. `{{+120m}}` becomes the local clock 120 minutes from now — the eval runs on the real clock because `cron_schedule` does. |
| `planner` | Instead of `inbound`: send the daily planner wake. |
| `cron` | Instead of `inbound`: the prompt of a scheduled job the model set. |
| `history` | Prior `user` / `assistant` turns appended to the session first. |
| `waiting` | Arms `waiting_for_reply` before the turn. For `[reaction] 👍 on: …` inbound: is the 👍 an answer. |
| `memory` | Seed rows: `kind`, `subject`, `content`. |
| `self` | `SELF.md` body (`- ` bullets). Empty file when absent. |
| `tools` | Canned MCP tools: `name` (must be `server__name`), `description`, optional `params` schema, `result` returned every call — `{{+90m}}` in a result expands like `inbound`. |
| `tools_from` | Servers whose **real** catalog replaces hand-written defs — see below. |
| `force` | MCP prefixes published without `mcp_enable`. Leave empty to test the off → enable → call path. |
| `expect` | The shape contract — see the failure table. `round_budget` is the cost note, not a check. `parallel`: tool names that must share one Completer round; a later round that holds the whole batch passes, splitting them into one call per round fails. `tools_called[].max_calls` caps a metered tool. `prices_from_tools` fails any `$N` the tools did not return. `react` / `react_only` / `no_model_call` are the reaction gates. |

### Real catalogs (`tools_from`)

A hand-written `params` block is the eval's guess at a plugin's
interface, and the guess drifts. `tools_from: ["rentals"]` publishes the
server's real catalog instead: the runner reads
`harness/eval/fixtures/mcp.toml` and asks the in-process plugin
(`harness/plugins/flights`, `rentals`, `google`) for names, descriptions,
and input schemas. Google is filtered to the `tools` allowlist in that
file (`calendar_list_events`, `calendar_create_events`). Nothing is
called: results stay canned, so a placeholder key never reaches a vendor.

A fixture `tools` entry whose name the live plugin does not publish
fails before any model call, and so does a `tools_from` server with no
row in `mcp.toml`. Hand-written tools for other servers (garmin, and
google tools outside the allowlist) stay canned.

The fixtures that set `tools_from` name `rentals`, `flights`, and
`google`.

Then:

```sh
npm test                                              # parses, regexes compile
EVAL_N=1 EVAL_ONLY=<name> npm run eval                # first live read
```

Four kinds of fixture live in the directory. **Single-batch rules** —
one tool round and a reply, `round_budget` 2 or 3 (`parallel_batch` is the
single-batch rule for two independent lookups sharing one round, not a single tool round). **Completion**
fixtures (the flight, the gym check-in, the dinner planner): the check
is that the legwork happened, and the model may take the rounds it
needs. **Spend** fixtures on real catalogs: a metered API, `max_calls`
on the search, `tools_not_called` on the per-item detail calls nobody
asked for, `prices_from_tools` on the reply. **Reaction** fixtures: the
agent's `[react 👍]` where a sentence would be noise, and the human's
👍 / 👎 on the agent's message — free when idle, an answer when the
agent was waiting, never nothing when negative.
`planner_weight_on_pace` pins `now` to Wednesday 2026-10-07 08:00 Pacific, same as `planner_midweek_quiet`, so `[progress]` has no `weeks:` line.

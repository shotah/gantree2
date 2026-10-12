# Troubleshooting

> Pitch: [../README.md](../README.md) · Contract: [contract.md](contract.md)

Fixes for common “why is it doing that?” moments. Prefer the `log` frame
(`self-notes disabled`, `self distill`, `TOOL_MAX_ITERATIONS`) before
rewriting persona. Long-horizon personality lives in `SELF.md` — prune it
like you would a friend’s inside jokes. Writing a tight `PERSONA.md` (no MCP
catalog, north-star vs tracker): [persona.md](persona.md). Horizon split:
[persona.md](persona.md#where-the-horizon-lives).

Persona and `SELF.md` are rows in the Agent DO. Settings edits them
on the folds.

## Alarm not firing

The clock is the Agent DO alarm. `nextAlarm()` is null when nothing is
due, and then no alarm is armed. If an agent is quiet past a job you
scheduled, send any message so the harness opens and arms the next wake.
`MEMORY_CONSOLIDATE_MINUTES=0` skips the consolidation pass only. Cron
and watches still use the same alarm.

## `mcp_enable` — the tool is not in this turn

Prefixes stay off until the model calls `mcp_enable`, then the schema
is on the next model call in that turn. A call before that is refused
with `not enabled`. Brief holds drop after 6 hours idle, short holds
after 27. Unprefixed builtins (`memory_*`, `cron_*`, `self_note`,
`web_search`, `mcp_enable`) never drop.

`DYNAMIC_TOOLS=false` publishes the full catalog and there is no
`mcp_enable` step. `MCP_ENABLE_FORCE` is a comma-separated list of
prefixes that stay on (`google__calendar,garmin`). `/tools` shows what
this chat can call right now.

## Plugin skipped (`no_key`, `no_oauth`)

The status fold lists `published` and `skipped`. `no_key` means a
required env value is missing (`GOOGLE_MAPS_API_KEY`,
`X_BEARER_TOKEN`, `FEEDS_USER_AGENT`, Garmin email and password, the
Google or Strava client id and secret). `no_oauth` means the key is
there and the token is not: `/auth <plugin>` or the Tools-fold Connect
button, then the catch ([auth.md](auth.md)). Garmin is
`/auth garmin` and then the emailed code. `disabled` and `error` are
the other skip reasons.

`GARMIN_TOOL_TIER` (`core`, `extended`, `complete`) and
`GOOGLE_TOOL_PRESET` (`lean`, `everyday`, `all`) change which tools
those plugins publish. They do not by themselves mark the plugin
skipped. Grants from the Tools fold reach the registry: a plugin left
off the list is not in the catalog.

## Persona imported once

The first time the harness opens its persona store, `config.persona`
is copied into `PERSONA.md` if `persona_file` has no rows and the
string is not blank. That copy does not run again once any row
exists. Saving the persona fold writes the row, and so does a `PATCH`
of `config.persona` when the string changes. Edit the fold, or
`PUT /api/agents/:slug/persona`
with `{ "name": "PERSONA.md", "text": "…" }`. `DELETE` removes one
file. A blank config does not block a later seed: import skips blank
text without writing a row.

## `SELF.md` — personality drift

The harness's **self-notes** feature is long-horizon personality: the agent grows
a voice that survives `/new`.

- The harness overwrites the `SELF.md` header and the `PERSONA.md` Self-notes and Location pins sections. Your bullets stay.
- Mid-chat: builtin `self_note` appends a short line.
- On history trim: new `Voice:` bits append the same way (no extra model call).
- On `/new`: a distill pass **merges** into the file from the dying session,
  the rolling `Voice:` block, and existing notes. Quoted jokes that the model
  drops are restored. A bland session (no `Voice:`, no quoted bits) leaves
  `SELF.md` as-is. Session `Facts:` park in SQLite memory — not `PERSONA.md`.
- Loaded every turn as part of the persona (after `PERSONA.md`). Cap ~4KB.

That is the feature — and the footgun. Notes reinforce themselves: a snarky
line becomes “who I am,” then the next distill keeps it. **You own the veto.**

### When to audit

Open `SELF.md` (or wipe it) when:

- The agent feels wrong after a reset — too clingy, too snarky, off-brand jokes
- It keeps referencing a game / nickname / bit you are done with
- **Near-duplicate bullets pile up** (agent treated `self_note` like a rewrite —
  prune dupes; persona should say append-only + skip-if-already-there)
- A long tool-heavy or argumentative session just ended and `/new` distilled
  anyway (Voice or quotes were present) — prune if the mood locked in
- **Do not `/new` a bland session to “get him back.”** Distill skips when there
  is no `Voice:` and no quoted bits, but prune `SELF.md` first if it is already
  vibe-words instead of jokes.
- **Progress logs / mileage / open loops in `SELF.md`** — that is the tracker.
  One north-star sentence can stay; the rest is `memory_store` (`aim/<area>`).
  See [persona.md](persona.md#where-the-horizon-lives).
- You shared the allowlist with someone else and want a clean slate for them

### How to fix

Prune the self fold, or `PUT /api/agents/:slug/self` with the shorter
text. The next turn reads that row.

| Action | Effect |
| --- | --- |
| Delete specific `-` lines | Surgical prune; next turn loads the shorter file |
| Truncate to the header | Fresh personality; the next `/new` can grow it again |

The door's threats are in [access.md](access.md#threats).

### Sell vs safety

**Why keep it on:** without `SELF.md`, the funny agent lives only in
chat history. `/new` or a context blow-up starts them over. Self-notes
are how ownership means continuity.

**Why audit:** the agent cannot violate `PERSONA.md` by the design of
the prompt, but tone and rituals are soft. Treat `SELF.md` like a log
you review.

## Agent “forgot” who it was after `/new`

Without `SELF.md`, session history and the rolling summary are wiped
and only `PERSONA.md` remains.

With self-notes, `/new` replies
`session reset — personality distilled into SELF.md` after a session
that has a `Voice:` line or quoted jokes. A bland tool session returns
plain `session reset` and leaves `SELF.md` alone.

1. Read `SELF.md` after `/new`. If the file is vibe-words and not
   quotes, prune it. Another `/new` will not grow those back.
2. Distill is best-effort. If the model call fails, reset still happens
   and the log shows `self distill: … failed`. Prior `SELF.md` content
   is kept.
3. `/tokens` prints `Voice: yes` or `Voice: (none)` next to `summary`.

## Agent keeps calling tools forever / burns tokens

Default tool budget is `TOOL_MAX_ITERATIONS=15` tool rounds, then a
landing call with tools withheld so the turn ends in a real reply.
A soft warning fires around 70% of the budget. If the model still asks
for tools on the landing call, the turn lands on a plain "ran out of
tool calls" reply.

`/perf` `iters` / `tools` / `batch` / `rec` is the tell. Raise or lower
the round budget via `config.env` `TOOL_MAX_ITERATIONS`.

## Memory rows

Memory lives in the Agent DO's SQLite. Settings does not open that
database. `/new` clears `session_message` for that chat and does not
touch `memory`.

| kind | typical TTL | notes |
| --- | --- | --- |
| `episode` | 30 days | consolidator reads these |
| `fact` / `preference` / `person` / `insight` | none | hydrated. Months-scale plans: `insight` / `aim/<area>` |

`consolidated = 1` means processed (hidden from hydrate). `= 2` is
quarantined after parse failures. Same `kind+subject` supersedes the
old live row. `pref/hours` is the sleep/work/quiet stamp (`[hours]` on
every turn).

## More

| Topic | Doc |
| --- | --- |
| MCP name / auth failures | [mcp.md](mcp.md) · [auth.md](auth.md) |
| Slow local turns | `LLM_BASE_URL` on that agent |
| Who may talk | [access.md](access.md) |

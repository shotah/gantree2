# Cron, daily planner, and watches

Proactive jobs are **long-horizon work**: they live in SQLite and fire
inside the agent loop (tools allowed), then **push** on the chat room.
Jobs do not store a destination. A reminder next Tuesday is planning; a
chatbot that only answers now is not.

There is no ticker. `nextAlarm()` is the soonest due row across cron,
watches, and memory consolidation. `edge/agent.do.ts` `alarm()` calls
`brain.alarm()`, which runs `fireDue`, polls due watches, and runs a
consolidation pass when `MEMORY_CONSOLIDATE_MINUTES` says so (default
30; `0` turns that pass off). The handler arms the next wake. Cost
between fires is zero. One clock: [architecture.md](architecture.md) §5.
A push is a `push` frame on the room, including a cron or watch wake.

Live-data jobs (calendar, mail, fitness, search, sheets) get a tool-first
wrapper plus a last-token system note so the model calls tools before drafting
the digest. If it still writes the report with zero tool calls, the agent loop
nudges once; a second no-tool draft is refused instead of shipping invented
metrics. Prior `[cron]` turns are omitted from that job's prompt so yesterday's
digest cannot few-shot the next one. Plain reminders ("submit my timecard")
are unchanged.

A months-scale **aim** is not a cron by itself. North-star sentences live in
`SELF.md`; progress in memory (`aim/<area>`); cron is the wake. The daily
planner is one session at one clock time: pull calendar, mail, and fitness,
then set that day's crons. Sick, vacation, or a day off stays `[silent]`.
Learned `pref/hours` sleep skips example pings; the daily planner and an
explicit "remind me at 9pm" still fire. Pin follow-through with `memory_subject` (or `memory_id`) so the
wake is not a hydrate lottery — the subject is known before `memory_store`
returns, so the store and the `cron_schedule` go out in one batch. A goal with no wake is a dusty row — [persona.md](persona.md#where-the-horizon-lives).

Cron delivers one `push` when the job speaks. Live-data replies append
`— tools: name, …` or `— tools: (none)` so a skipped pull is visible in
chat. Server logs still show `tool call` / `model call` (the `log`
frame — [contract.md](contract.md)).

The model can skip the push by replying with `[silent]` (first line). The job
still runs and the turn is stored; nothing is sent to chat. Use that for
all-clear / work-only jobs (dead-man, health checks) and for the daily
planner when the day needs no human-facing message.

## Config

| Env | Default | Meaning |
| --- | --- | --- |
| `CRON_ENABLED` | `true` | Master switch |
| `CRON_TZ` | `America/Los_Angeles` | IANA timezone for clock times (Pacific — SJ / SF / SEA / LA) |
| `CRON_MAX_JOBS` | `50` | Cap on enabled jobs |
| `MEMORY_CONSOLIDATE_MINUTES` | `30` | Consolidation period. `0` turns that pass off |
| `DAILY_PLANNER_AT` | `07:10` | One planning session a day, local clock (`CRON_TZ`). `/planner 09:30` overrides it for this agent. `0` or `/planner off` disables it |
| `EXAMPLES_QTY` | `1-2` | **On by default** capability-example pings. Empty or `0` = no proactive pings. `/examples` on-demand still works |
| `EXAMPLES_START_HOUR` | `6` | Local window start for examples pings |
| `EXAMPLES_END_HOUR` | `21` | Local window end (exclusive) |
| `EXAMPLES_SKIP_RECENT_MINUTES` | `60` | Skip/defer if the human messaged within this many minutes |

## Builtin tools

| Tool | Purpose |
| --- | --- |
| `cron_schedule` | Create a job for this agent. Optional `memory_id` / `memory_subject` pins a memory row; the wake injects `[job memory]`. Push is a `push` frame on the room. |
| `cron_list` | List active jobs |
| `cron_cancel` | Disable by id |

### `when` / `repeat`

| when | repeat | Result |
| --- | --- | --- |
| `in 30m` | `once` (default) | One-shot relative |
| `17:00` | `once` | Next 5pm in `CRON_TZ` |
| `17:00` | `daily` | Every day at 5pm |
| `every:1h` | — | Interval from now |
| RFC3339 | `once` | Absolute UTC/offset time |
| `07:10` | `planner` | Move the daily planner to that clock (persists; one job, not a second session) |
| `1-2@06-21` | _(boot)_ | Examples planner only: qty spread across a local hour window (`examples` / `examples_ping`) |

Example prompts the model can schedule:

```text
Remind me at 5pm to submit my timecard.
At 5pm daily: summarize calendar + work email for the past 8 hours.
At midnight daily: check last 48h of chat + Garmin. If all-clear, reply [silent].
```

## Daily planner (on by default)

One planning session a day at one clock time (`DAILY_PLANNER_AT`, default
`07:10` in `CRON_TZ`). It pulls calendar, mail, and fitness, then sets that
day's crons and (ask-first) events. There is no quantity and no hour window.
Sick, vacation, holiday, or a quiet day: reply `[silent]` and do not schedule
nag crons. The session still runs so the model can look and decide.

On boot, one `daily_planner` job is bound to the agent conversation (`gantry`).
Jobs do not store a chat or user id. Push delivers to the room.
`/planner off` opts out.

Chat and settings follow-ups: [planner-siblings.md](planner-siblings.md).

Chat controls (persist on the agent, like `/examples`):

| Command | Effect |
| --- | --- |
| `/planner` | Status (default from `config.env`, this agent's clock) |
| `/planner on` | Inherit `DAILY_PLANNER_AT` |
| `/planner off` | Opt out (dated user crons still fire) |
| `/planner 09:30` | Move the clock (`9:30am` and `9am` work too) |

The agent moves it the same way: `cron_schedule` `when=HH:MM` `repeat=planner`.
That writes the session clock and keeps the one job. A move during today's
session, or after today's session already ran, schedules tomorrow so there is
not a second burn today.

How it works:

1. Boot ensures one enabled `daily_planner` row. Same clock and prompt leave
   `next_run` alone. A clock change recomputes the next future slot.
2. The wake runs the full agent loop (memory, cron, MCP tools) with the
   kernel planning prompt. A zero-tool draft is nudged once; a second skip
   stays `[silent]`. Learned sleep and recent chat do not defer this job.
3. `[silent]` unless one decision or nudge needs the human. Ask-first still
   applies (no email, spend, or public posts).
4. `/planner off` disables the row. Dated reminders are separate jobs.

## Aims ledger

What happened toward an aim is not another memory sentence. `aim_log`
writes one event scored `-3…+3` against each live `aim/<area>` it touches.
`aim_history` lists those rows with ids. The rating on `[aims]` is a
stamp (30-day mean, 7-day sum, streak, last note). The planner turn also
gets `[progress]`: five local days, `·` when nothing was logged. The
week's first session (Sunday in `CRON_TZ`) adds the week means, the
slope, and any correlation on that same turn. There is no second job.
`/aims`
prints the same block; `/aims <area>` is the last two weeks with ids;
`/aims rubric` is the scale. The aims write-up is not carried. The
tables settings may read are in [contract.md](contract.md#ledger-tables).

## Capability examples / training wheels (on by default)

Inventory-aware multi-step ideas (propose only — no tools on the ping).
**On unless `EXAMPLES_QTY` is empty or `0`.** Default is `1-2` pings/day.

Chat controls:

| Command | Effect |
| --- | --- |
| `/examples` | One suggestion now (filtered to connected MCP servers) |
| `/examples on` / `true` | Re-enable proactive pings |
| `/examples off` / `false` | Opt out (persists across restarts) |

Boot auto-binds one examples **planner** for the agent (same conversation as
the daily planner), skipping if opted out. Pings pick a curated seed whose required server
prefixes are all present in the live `/tools` catalog, then ask the model to
localize it. Turn off anytime with `/examples off`.

```env
EXAMPLES_QTY=1-2
EXAMPLES_START_HOUR=6
EXAMPLES_END_HOUR=21
# EXAMPLES_QTY=0   # disable proactive pings; /examples still works
# EXAMPLES_SKIP_RECENT_MINUTES=60
```

## Inspect

The rows are in the Agent DO's SQLite. Settings does not open that
database.

```sql
SELECT id, kind, expr, timezone, next_run_at, enabled, running,
       substr(prompt, 1, 60), last_error
FROM cron_job
ORDER BY id DESC
LIMIT 20;
```

Disable by hand:

```sql
UPDATE cron_job SET enabled = 0, running = 0 WHERE id = 3;
```

## Overlap policy

Jobs run **serially** on the poller. A job sets `running=1` while the agent
turn executes; due rows that are still running are skipped until `Finish`.

On runner boot, any leftover `running=1` flags (crash/OOM mid-turn) are cleared so
jobs become due again. `Finish` / `Defer` only apply while `running=1` and never
re-enable a job that was cancelled mid-flight.

One-shot jobs disable after a successful (or failed) fire. Daily/every advance
`next_run_at`. Push failures are recorded in `last_error`. `cron_list` still
shows that row (`enabled=0`) — gone from the *enabled* set is not a delivery.

## Trace a wake (agent → room)

A cron fire disappearing from the enabled queue only means the job
finished (one-shot disable, silent skip, empty reply, or push error).
It does not mean the phone got a frame.

On this product the hops are inside the DO: the alarm calls
`brain.alarm()`, the runner runs the turn, and a spoken result is a
`push` frame the DO fans to `sub:<user_id>` (or every phone in the room
when `user_id` is empty), plus Web Push if that socket is gone.

The `log` frame (or the platform tail) carries the same id:

```text
cron job firing     id=319 session_id=gantry
cron silent skip    outcome=silent          # Handle ran; nothing written to the room
cron job pushed     outcome=push frame_id=cron-319-…
cron push failed    outcome=error           # last_error on the row
```

The phone bubble `id` is that `frame_id`. Session id is `gantry`.

---

## Event watches

A watch is a **cursor + poll**, not a chat loop. Quiet ticks call an MCP fetch
tool and **never** touch the Completer. New item ids wake the same agent loop
as cron, then **push** on the room — or skip if the reply is
`[silent]`. First poll seeds the cursor (no backlog dump). Do
not fake this with `cron_schedule` + “fetch the feed.”

```text
alarm → plugin call(tool, args) → compare ids → empty? stop
                               → new? agent turn → push (or [silent])
```

The poller shares the cron alarm.

| Env | Default | Meaning |
| --- | --- | --- |
| `WATCH_ENABLED` | `true` | Master switch |
| `WATCH_MAX` | `50` | Cap on enabled watches |

| Tool | Purpose |
| --- | --- |
| `watch_add` | Subscribe: prefixed MCP `tool` + `args` + `interval` (default `15m`, min `1m`) + optional `label`. On a server with a `budget` the interval is raised to the budget floor (`1/day` → 24h) and the reply says so |
| `watch_list` | List active watches |
| `watch_cancel` | Disable by id |

The poller does not know RSS vs X. A watch row is `tool` + `args`.
Plugins return `{items:[{id,…}]}` JSON. They live under
`brain/plugins/<name>/`.

| Plugin | Tools | Watch args |
| --- | --- | --- |
| `feeds` | `items_list`, `source_resolve` | `{ url }` |
| `twitter` | `posts_list` | `{ handle }` — prefer 30–60m (pay-per-use). The plugin keeps its own monthly read budget |
| `rentals` / `flights` | `listings_search`, `offers_search` | Set the interval to the plan. A 15m default is 96 calls a day |

Put `X_BEARER_TOKEN` in `config.env`. Prior `[watch]` / `[cron]` turns
are omitted from the next scheduled prompt so they cannot few-shot the
next summary.

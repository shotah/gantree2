# Daily planner: chat and settings

The daily planner replaced Spark of life with one planning session. This
file is the checklist for the chat PWA and the settings screens. The
clock is [cron.md](cron.md). What settings may write is
[contract.md](contract.md).

Neither surface gets a new socket, frame kind, or `status` field.
`announce` emits `cmds` when the harness opens. Work is menus and any
string that still names spark.

---

## Chat

The room receives the menu as a `cmds` frame. The catalog includes
`planner` (`args: true`, hint `daily planning session (on|off|HH:MM)`)
and does not have `spark` or `engagement`. The harness publishes it
from `harness/slash`.

Chat pushes are still `{ kind: "push", text }`. A planning session that
speaks starts with `[cron] Daily planner`. A `[silent]` session sends
nothing.

Update the PWA only where a string is hardcoded:

| Surface | Change |
| --- | --- |
| Command picker, icons, or tests that name `/spark` or `/engagement` | `/planner`, with an argument (`on`, `off`, or a clock like `09:30`) |
| Any match on `[cron] Spark of life` | `[cron] Daily planner` |
| Room, theme, face, allowlist, reactions | Leave them |

A picker that renders the `cmds` frame as-is needs no release for the
new command. Cab uses the same room and the same rule. Cab is not in
this repo ([todo.md](todo.md) §0).

---

## Settings

No new required env var. Planner turns log `source=cron` on the `perf`
frame ([contract.md](contract.md)).

### Persona seed

`app/components/agents/personaTemplate.ts` is the seed a new agent
copies into `config.persona`. It includes the `[cron] Daily planner`
example and the `cron / daily planner` layer. Drop Spark of life,
`/spark`, and `/engagement`.

### Env form

Optional, same place as the other cron knobs (`config.env`):

| Key | Default | Meaning |
| --- | --- | --- |
| `DAILY_PLANNER_AT` | `07:10` | Local clock (`CRON_TZ`). `HH:MM` or `H:MM`. |

There is no spark quantity env. `/planner 09:30` on the agent overrides
this and is stored in the Agent DO's SQLite, not in `config.env`.
Settings does not open that database.

| What | Now |
| --- | --- |
| `cron_job.kind` | `daily_planner` for the one session. `expr` is `HH:MM` (for example `07:10`). |
| `cron_job.kind` | `examples` / `examples_ping` are unchanged. |
| `session_pref.planner_at` | `''` inherit `DAILY_PLANNER_AT`, `0` off, or `HH:MM` override. |

The harness does not read `spark_qty`. A board that filters on `spark` or
`spark_ping` will not show the daily session. Label `daily_planner` as
the planning session.

### Docs and UI copy

Anywhere settings still says Spark of life, `/spark`, `/engagement`,
`repeat=spark`, or “3–5 wakes a day”, switch it to one clock,
`DAILY_PLANNER_AT`, `/planner`, and `cron_schedule` `repeat=planner`.

# Daily planner: chat and settings

The daily planner replaced Spark of life with one planning session. This
file is the checklist for the chat PWA and the settings screens. The
clock is [cron.md](cron.md). What settings may write is
[contract.md](contract.md).

Neither surface gets a new socket, frame kind, or `status` field.
On a native agent, `announce` emits `cmds` when the brain opens. On a
container agent, the harness sends that frame when it dials. Work is
menus and any string that still names spark.

---

## Chat

The room receives the menu as a `cmds` frame. The catalog includes
`planner` (`args: true`, hint `daily planning session (on|off|HH:MM)`)
and does not have `spark` or `engagement`. A native brain publishes it
from `brain/slash`. A container harness publishes it from
`internal/channel/chat` (that tree may still say `pendant` until Phase
4).

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

The harness boots without a new required env var. The `status` JSON is
unchanged ([contract.md](contract.md)). Planner turns still log
`msg=turn perf` with `source=cron`, and that line arrives as a `perf`
frame.

### Persona seed

`harness/examples/persona/PERSONA.example.md` is the only seed (lands
with [todo.md](todo.md) §5). **Replace from template** loads that file.
It has to include the `[cron] Daily planner` example and the
`cron / daily planner` layer. Drop Spark of life, `/spark`, and
`/engagement`. Seed tests on the settings side should pin the planner
wording the way they pin `pref/hours` and `pref/calendar`. Those tests
land with [todo.md](todo.md) §4.

### Env form

Optional, same place as the other cron knobs (`config.env`; the example
file is `harness/.env.example`):

| Key | Default | Meaning |
| --- | --- | --- |
| `DAILY_PLANNER_AT` | `07:10` | Local clock (`CRON_TZ`). `HH:MM` or `H:MM`. |

There is no spark quantity env to remove. `/planner 09:30` on the agent
overrides this and is stored in `gantry.db`, not in `config.env`.

### SQLite the board may already read

`gantry.db` on the container disk, and in the R2 snapshot
([architecture.md](architecture.md)). Settings does not open the live
file.

| What | Now |
| --- | --- |
| `cron_job.kind` | `daily_planner` for the one session. `expr` is `HH:MM` (for example `07:10`). |
| `cron_job.kind` | `examples` / `examples_ping` are unchanged. |
| `session_pref.planner_at` | `''` inherit `DAILY_PLANNER_AT`, `0` off, or `HH:MM` override. Added with `ALTER TABLE`; new databases create the column directly. |

This binary does not read `spark_qty` and does not rewrite old `spark` /
`spark_ping` rows. A board that filters on those kinds will not show the
daily session. Label `daily_planner` as the planning session. Leave
`spark_qty` alone.

### Docs and UI copy

Anywhere settings still says Spark of life, `/spark`, `/engagement`,
`repeat=spark`, or “3–5 wakes a day”, switch it to one clock,
`DAILY_PLANNER_AT`, `/planner`, and `cron_schedule` `repeat=planner`.

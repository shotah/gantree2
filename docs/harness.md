# The harness — decision record

**Decision.** 2026-10-11, later the same day as
[runtime.md](runtime.md). The lease on that page was not built. The
harness is TypeScript running inside the Agent Durable Object: Vinext,
TypeScript, and Cloudflare Workers throughout, the same bundle celld
runs at home.

Pictures: [architecture.md](architecture.md) §5. The clock:
[cron.md](cron.md). Frames settings reads: [contract.md](contract.md).
The work: [todo.md](todo.md). Behavioral eval is Vitest (`harness/eval`,
`npm run eval`, [eval_setup.md](eval_setup.md)).

---

## Why the container lost

The container is the wrong runtime for an agent that is always
available and is not billed while idle. A 15-minute lease, renewed by
harness frames and woken by a phone message or a Durable Object
alarm, would still be an image, a cold start of seconds, a socket
between the harness and the room, a disk that has to be snapshotted to
R2, and a bill for the time it is awake. A Durable
Object wakes in milliseconds, costs nothing between alarms, and keeps
SQLite that outlives the invocation. That is the runtime. A is
cancelled.

The morning's second step is cancelled with it. That step left the
twelve MCP servers as processes and moved them onto Streamable HTTP
behind one shared sleepy container. They are rewritten as in-process
plugin modules. Each stays its own directory, its own manifest name,
and its own tools. There is no external process and no MCP transport,
stdio or HTTP.

---

## Go in WASM — rejected

TinyGo, and Go compiled to WASM on the ordinary toolchain, was the
proposal for keeping the harness source and dropping the container.
Rejected.

Workers isolates are single-threaded. Goroutines under WASM are
concurrency on that one thread. They are not parallelism. Parallel
tool calls in one batch were the reason a Go process looked
attractive. WASM does not provide the cores that reason needs.

Durable Object classes cannot be implemented in Go on the mainstream
toolchain. `syumai/workers-go` calls Workers through generated stubs;
the class the runtime constructs is still JavaScript. Go-backed
Durable Objects exist only in a fork of the runtime, not in the one
this repo deploys.

Two pieces of the harness do not survive the move on any toolchain.
`modernc.org/sqlite` is a process database; the isolate's database is
`ctx.storage.sql`. The MCP host is `exec.Command` plus a stdio
transport (`harness/internal/mcp/host.go`); an isolate has no child
processes. A WASM port would rewrite both of those anyway.

On the work that is left — orchestrating I/O, waiting on the model
and on tool fetches — WASM Go is slower than JIT'd JavaScript, and it
cold-starts worse. An agent turn is that waiting.

Go compiled to WASM as a pure-compute module, for the agent loop or
for memory and aims, is a possible later experiment. Not now. Those
packages port to TypeScript with the rest. A second language in the
isolate waits until the native harness has parity and a measurement
says a compute kernel is the slow part.

---

## Where the agent runs

The harness is the Agent Durable Object. There is no second process, no
image, and no socket between the harness and the room.
`edge/agent.do.ts` fans the harness's frames to the phones on the room.
The Agent DO alarm runs `harness.alarm()` and arms `nextAlarm()`.

---

## The contract — `harness/core`

Wave 1's shared surface. Six modules under `harness/core/`;
`index.ts` re-exports them. Packages import the leaf. Tests mirror
the folder (`test/harness/core/sql.test.ts` is the SQL suite) and pass
a `node:sqlite` `DatabaseSync` into `nodeSql`. `harness/core` does not
import `node:sqlite`, so the Worker bundle does not either.

### Sql

`Sql` is three methods and positional `?` bindings. `exec` runs one
statement and returns every row; DDL and writes return `[]`. `one`
returns the first row or `null`. `changes()` is the number of rows
the last `exec` wrote.

Production is `doSql`, a wrap of the Durable Object's
`ctx.storage.sql`. Tests are `nodeSql` over a `node:sqlite`
`DatabaseSync`, in memory. The dialect matches, so a package ports
its Go `database/sql` once.

`migrate(sql, migrations)` applies ordered steps and returns the ids
it applied. A step is `{ id, up }`. `id` is unique per package
(`memory.001`); `up` is a list of statements. Applied ids live in one
shared `brain_migration` table (`id TEXT PRIMARY KEY`, `at INTEGER
NOT NULL`). Each package calls `migrate` with its own list on open.
An id already present is skipped. There is no transaction API on
`Sql`: each `exec` is atomic on the DO, and a Worker invocation is
one implicit transaction. A package that truly needs a wider one
wraps `ctx.storage.transactionSync` behind this interface rather than
reaching past it.

### Clock

Time is injected. `Clock` is `now()` in epoch milliseconds and an
IANA `zone` (`UTC` when the zone is unknown). `systemClock` reads the
wall clock. `fixedClock` starts at a given instant and moves only
when a test calls `set` or `tick`, so a cron can sit at 07:10 and
fire on that instant. Packages do not call `Date.now()` themselves.

Zone math is `Intl.DateTimeFormat`. No timezone library, no copied
DST table. `localParts` splits an instant in a zone. `zoneOffsetMs`
is that zone's offset from UTC at that instant, positive east of
UTC. `atLocalTime` is the epoch for an hour and minute on the local
calendar day that contains an instant, with the offset re-derived at
the guessed instant so a DST boundary does not land an hour off.
Cron, the daily planner, and examples use these to turn `CRON_TZ`
and a wall clock into the next alarm.

### Logger

`Logger` is `debug`, `info`, `warn`, `error`, and `with(fields)` for
a fixed context (`{ pkg: "memory" }`). Records go to a `LogSink`:
`level`, `message`, `at` (epoch ms), and optional `fields`. In the DO
the sink emits a `log` frame for the agents screen and writes
`console.*` for Workers Logs. `consoleSink` is the console half.
Tests collect an array (`memorySink`). `silentLogger` discards.

### ChatProvider

One OpenAI-compatible chat-completions client, the port of
`harness/internal/provider`. The implementation lives in
`harness/provider` and uses the `openai` package against
`LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. The types in
`harness/core/provider.ts` are the shapes the loop and the eval
fixtures already assume.

A `Message` is `system`, `user`, `assistant`, or `tool`. User messages
may carry `imageUrls` (`https` or `data:image/…;base64,…`). An
assistant message may carry `toolCalls`. A tool message carries
`toolCallId`. A `ToolCall` keeps `arguments` as the model's JSON text,
and an optional `raw` for provider fields that must be echoed back
(Gemini `extra_content.google.thought_signature`). `ChatResult` is
content, optional thinking, tool calls, finish reason, model, service
tier, and `usage`. A usage count of zero means the provider omitted
it. `completeStream` reports cumulative text — the string a `draft`
frame carries — not deltas. `forceToolNames` constrains the reply to
one named tool through the provider's structured-output grammar;
`tools` stays populated on that request too. `systemFold` (`auto`,
`one`, `many`) is how system messages fold for a provider that allows
only one.

### Plugin, Tool, TokenStore

What was twelve stdio servers is twelve `Plugin` values. A plugin is
built with a `PluginContext`: the agent's env map (read, never
logged), the shared `Sql` (prefix tables with the plugin name,
`strava_token`), the `Clock`, the `Logger`, `fetch`, and a
`TokenStore`.

`ready` returns `null` when the plugin can serve, otherwise a
`SkipReason` of `no_key`, `no_oauth`, `disabled`, or `error`. The loop
publishes that on the `status` frame's skipped list. `tools` returns
the list for that context and is stable across calls. A `Tool` is a
manifest entry — `name`, `description`, `inputSchema` — plus
`call(args, ctx)`. `ToolResult` is an MCP result: `content` entries of
`text`, `image`, or `resource`, and `isError` when the failure is text
the model should see. `CallContext` is the per-call facts the harness
used to pass as env or `_meta`: `userId` (empty on a cron or system
turn), `sessionId`, optional `geo`, optional `AbortSignal`.
`textResult`, `errorResult`, and `jsonResult` build the common
results.

The shapes stay MCP-shaped so manifests, the Tools grid, prompts, and
eval fixtures do not change. Nothing between processes speaks MCP,
because there is no other process.

`TokenStore` is `get`, `put`, and `delete` by provider id (`google`,
`strava`, `garmin`). The plugin sees a plaintext `OAuthToken`:
access token, optional refresh token, expiry in epoch ms, scope,
token type, and a string map of provider extras (Garmin consumer
secrets, an athlete id). The implementation is in `harness/tools`, not
on the interface. It stores the token AES-256-GCM in SQLite. The key
is the Agent DO's `snapshot.key`, 32 bytes, base64
([security.md](security.md)).

A plugin with a provider login also implements `authStart` (the URL
to show the human) and `authFinish` (exchange the code, store the
token). `/auth <plugin>` seals an `oauth-catch` JWE (`{ slug, plugin }`)
and returns the provider URL. `GET /api/auth/catch` opens that state
and calls `authFinish`. Garmin stays email, password, and an MFA
code. The methods were on the interface in wave 1 so the plugins
could carry their login with them.

### Wire

`harness/core/wire.ts` is the frame boundary. `edge/agent.do.ts` fans
the phone-facing frames out. Those kinds are `reply`, `draft`,
`typing`, `react`, `cmds`, `aims`, `todo`, `allow`, and `push`.
`push` is a delivered turn, including a cron or watch wake.
`status`, `perf`, and `log` fold into the Agent DO's status, samples,
and log ring (`lib/agents/status.ts`) and are not fanned to phones.
Inbound, after the DO has stamped identity, is a `WireFrame` of kind
`inbound`, `react`, `ack`, or `pin`, with `user_id` set. Phone-facing
frames are the existing `WireFrame` from `lib/chat/frame.ts`.

`status` on this side carries `published` and `skipped` (`name`,
`reason`). `perf` carries optional `turn`, `source`, and `outcome`,
plus `tokens.prompt` and `tokens.completion`. `log` is one rate-capped
line: `level`, `message`, optional `at`, optional `dropped`. The field
lists the board already charts stay the ones a finished turn has to
fill. The loop fills them on these kinds. The harness does not emit
`snapshot`.

---

## Package map

The left column is the package this row replaced. Table names in
SQLite are the names those packages used.

| Go | TypeScript | Wave |
| --- | --- | --- |
| `provider` | `harness/provider` | 1 |
| `session`, `here`, `selfnote`, `persona`, `slash` | `harness/session`, `harness/here`, `harness/selfnote`, `harness/persona`, `harness/slash` | 1 |
| `memory` | `harness/memory` | 1 |
| `aims` | `harness/aims` | 1 |
| `cron`, `examples` | `harness/cron`, `harness/examples` | 1 |
| `watch`, `websearch` | `harness/watch`, `harness/websearch` | 1 |
| `mcp` host and `mcpenable` enable rules | `harness/tools` | 1 |
| `harness/mcp/<name>`, twelve servers | `harness/plugins/<name>` | 1 |
| `agent` (the loop) | `harness/agent` | 2 |
| `channel/chat` and the `cmd/gantry` wiring | `harness/room` | 2 |

Persona and SELF.md live in SQL. `SELF.md` is the `selfnote` row.
Persona files are `persona_file` (`PERSONA.md`, then any other `.md`
name). The first open copies `config.persona` into `PERSONA.md` once,
and only when the table is empty and the text is non-blank. After
that the row is the text. The harness assembles those persona rows,
then SELF.md from its own store. A missing persona is still an empty
standing identity.

`slash` is the command catalog (`harness/internal/slash`): the list
the `cmds` frame publishes. Handlers stay next to the package that
owns the command; the catalog is one place.

Cron, examples, and watch share one alarm shape. The ticker goroutine
(`CRON_TICK_SECONDS`, a 15-second poll, and the watch poller on that
same ticker) becomes `nextDue()` and `fireDue()`. `nextDue` is the
soonest enabled row. The DO sets its alarm for that instant.
`alarm()` calls `fireDue`, which runs the job and arms the next
alarm. Cost between fires is zero. The alarm runs the job. Job
rows, `[silent]`, the daily planner, examples
pings, watch cursors, and push onto the current channel stay the
behavior in [cron.md](cron.md). Learned sleep, ask-first, and the
tool-first nudge on live-data jobs stay with the loop that `fireDue`
calls, which is `harness/agent`. The schedule tables and the due
calculation landed with wave 1; the loop runs the job.

`harness/tools` is the registry, the enable rules, the manifest drift
check, and the `TokenStore` implementation. Plugins register. The
registry is what `ready` and the tool catalog consult. The drift
check is the comparison the eval already runs: published tools
against the host-manifest. `mcpenable`'s rules move here. Its process
supervision does not.

The twelve plugins, under the names they have today: `chat`, `feeds`,
`flights`, `garmin`, `google`, `google-health`, `image`, `maps`,
`math`, `rentals`, `strava`, `twitter`.

These do not get a TypeScript folder:

| Go | Why it stops |
| --- | --- |
| `doctor`, `drain`, `heartbeat`, `logfwd` | They supervise a process: a one-shot boot report, a SIGTERM drain, a healthcheck row, a log forwarder. The isolate has no process to supervise. |
| `snapshot` | DO SQLite is durable on its own. |
| `config` | Env is the DO's config map. There is no process environment to load. |
| `mcp` transport, `mcpenable` process half | Spawn, stdio, and any HTTP MCP client. Enable rules and the drift check are the `harness/tools` row above. |
| `channel/telegram`, `channel/discord`, `channel/slack`, `channel/stdio` | Not ported. An open item ([channels.md](channels.md)). |

The entrypoint is the Agent DO. The wiring that turns a room message
into a turn is `harness/room`.

The behavioral eval fixtures live under `harness/eval`. `npm run eval`
runs Vitest with `vitest.eval.config.ts`. `eval.yml` calls that script.
Setup:
[eval_setup.md](eval_setup.md). Unit tests are Vitest under
`test/harness/`.

---

## Plugins are plural

A tool call costs a turn. Every plugin tool takes a set — a date range
(`start`/`end`, or `days`), an id or name list, or a prefix — and returns
a list. One match is `[item]`. A miss on one item is a row (`{ id, error }`),
not a failed call. Omitting the argument means today, or the obvious
default. A tool that is inherently one thing (`account_get`, one room
face) sets `single` on its `ToolDef` and says why.

The rule is `.cursor/rules/harness-plugins-plural.mdc`. The checker is
`test/harness/plugins/plural.test.ts`.

---

## Waves

Waves 1 and 2 have landed (2026-10-11). The behavioral eval is on
Vitest (`npm run eval`, [eval_setup.md](eval_setup.md)). The list of
what is still open is [todo.md](todo.md).

| Wave | What lands |
| --- | --- |
| **1** | `harness/core` and every wave-1 row in the map, including all twelve plugins. Landed. |
| **2** | `harness/agent` (the loop), `harness/room` (the DO adapter), and `/auth <plugin>` with the Worker catch. Landed. |
| **3** | Eval fixtures on Vitest (`harness/eval`, `npm run eval`). Landed. |

---

## Limits

The platform limits the port has to fit. Waiting on the model and on
`fetch` does not spend CPU time. A turn is that waiting.

| Limit | Value |
| --- | --- |
| Isolate memory | 128 MB |
| CPU time per invocation | 30 s by default; up to 5 min on Paid (`limits.cpu_ms`) |
| Subrequests per invocation | 1,000 |
| Durable Object SQLite | 10 GB |

---

## Data

The Agent DO's SQLite is the harness. `migrate` creates the tables on
first open. Table names match the packages that own them.

---

## What the other pages say

[architecture.md](architecture.md) is the picture.
[cron.md](cron.md) arms the alarm with `fireDue`.
[runtime.md](runtime.md) is the short record of the morning's question.
[contract.md](contract.md) says settings reads frames, does not open a
live database, and does not sit in a turn.

---

## Watch polling

The alarm polls watches. A fetch that finds nothing new does not
call the model.

`feeds__items_list` defaults to 60 minutes, floor 15 minutes.
`twitter__posts_list` defaults to 6 hours, floor 1 hour. Any other
tool defaults to 60 minutes, floor 15 minutes. The cap is 7 days.
`watch_add` with no interval uses that default. A shorter interval
is clamped up to the floor, and the result says so. `watches` adds
several in one call; `tool` still adds one.

Next-due times sit on a 5-minute grid, so watches that come due
near each other share one alarm. One alarm polls every due watch,
four fetches at a time. New items become one model turn, grouped by
watch, capped at 20 (`+N more` after that). No new items anywhere
means no model turn. The alarm time is that grid slot.

Quiet hours are the `pref/hours` sleep window, the same window the
planner already treats as do-not-disturb, plus a `quiet:` window
when one is set. Work is not quiet. The poller does not fetch during
those hours. The batch waits until the first grid slot after quiet
ends. Items stay at the source until then. A watch alarm is not
armed inside quiet hours. A cron job may still be.

A failed fetch doubles that watch's interval, up to 24 hours, and
increments `consecutive_errors`. A clean fetch resets both. Five
failures in a row pause the watch (`state=paused`, `last_error`
set). `watch_list` shows state, last error, and next due.
`watch_add` for the same tool and args un-pauses it.

Feed polls send `If-None-Match` and `If-Modified-Since` from the
etag and last-modified stored on the watch. HTTP 304 is no items
and no parse. Twitter reads share a monthly budget
(`X_MONTHLY_READS`, default 100, one read per handle). The counter
is the calendar month in the human's zone. Over budget, `posts_list`
returns an error row naming the budget and when it resets, and the
poller skips twitter watches until the month rolls.

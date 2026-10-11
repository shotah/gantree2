# The brain — decision record

**Decision.** 2026-10-11, later the same day as
[runtime.md](runtime.md). Step A on that page is cancelled; it was
not built. Option C is chosen, and the morning's tool-container step
is not part of it. The brain is TypeScript running inside the Agent
Durable Object. The native path is Vinext, TypeScript, and
Cloudflare Workers throughout: the bundle Cloudflare runs, and the
same bundle celld runs at home. The Go harness is frozen in
`harness/`, the spec and the running system until cutover, then
deprecated.

The morning page remains the record of what the container does today,
why Lambda lost, and what a lease would have looked like. Where its
**Order** says "A then C", this page wins. `sleepAfter` stays `"15m"`
until cutover.

Pictures of the room: [architecture.md](architecture.md) §5 is the
native lifecycle. The container pictures are
[§13](architecture.md#13-legacy-container-runtime). The clock this has
to keep: [cron.md](cron.md). Frames settings already reads:
[contract.md](contract.md). The work: [todo.md](todo.md). Behavioral
eval is Vitest (`brain/eval`, `npm run eval`,
[eval_setup.md](eval_setup.md)).

---

## Why the container lost

The container is the wrong runtime for an agent that is always
available and is not billed while idle. A 15-minute lease, renewed by
harness frames and woken by a phone message or a Durable Object
alarm, would still be an image, a cold start of seconds, a socket
between the brain and the room, a disk that has to be snapshotted to
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
tool calls in one batch were the reason the harness stayed Go
([architecture.md](architecture.md#13-legacy-container-runtime)). WASM does not provide the
cores that reason needs.

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
isolate waits until the native brain has parity and a measurement
says a compute kernel is the slow part.

---

## Where a native agent runs

The brain is the Agent Durable Object. Agent config gains
`runtime: "container" | "native"`. A native agent has no harness
process, no image, and no socket between brain and room.
`edge/agent.do.ts` fans the brain's frames out the same way it fans
the crane socket, so a phone cannot tell which runtime answered. An
agent left on `container` keeps the lifecycle in
[architecture.md](architecture.md#13-legacy-container-runtime),
including `"15m"` `sleepAfter`, until its own flag flips. One agent
can go native while the rest stay on the container. The Agent DO
alarm runs the brain only when the flag is `native`. It does not start
a stopped container.

`harness/` stays in the tree through that flip, frozen: the spec, and
the running system. The Go tests are what the port is checked
against. Wave 3 deletes the container classes and archives the
directory.

---

## The contract — `brain/core`

Wave 1's shared surface. Six modules under `brain/core/`;
`index.ts` re-exports them. Packages import the leaf. Tests mirror
the folder (`test/brain/core/sql.test.ts` is the SQL suite) and pass
a `node:sqlite` `DatabaseSync` into `nodeSql`. `brain/core` does not
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
`brain/provider` and uses the `openai` package against
`LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. The types in
`brain/core/provider.ts` are the shapes the loop and the eval
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
secrets, an athlete id). The implementation is in `brain/tools`, not
on the interface. It stores the token AES-256-GCM in SQLite. The key
is the Agent DO's snapshot key — the 32-byte `snapshot.key` already
minted for the harness `tokens_tar`
([security.md](security.md)).

A plugin with a provider login also implements `authStart` (the URL
to show the human) and `authFinish` (exchange the code, store the
token). `/auth <plugin>` calls `authStart` and, with a pasted code,
`authFinish`. `GET /api/auth/catch` calls `authFinish` when `state` is
an `oauth-catch` JWE. The slash command puts `auth-<ms>` in `state`
and does not call `sealOAuthCatch`. Both routes landed with the room
adapter. The methods were on the interface in wave 1 so the plugins
could carry their login with them.

### Wire

`brain/core/wire.ts` is the frame boundary. The brain emits the frames
the crane socket emitted, and `edge/agent.do.ts` fans them out
unchanged. Phone-facing kinds are `reply`, `draft`, `typing`,
`react`, `cmds`, `aims`, `todo`, `allow`, and `push`. `push` is the
kind `channel/chat` writes for a delivered turn, including a cron or
watch wake. `status`, `perf`, and `log` are the harness-only frames.
They fold into the Agent DO's status, samples, and log ring the same
way (`lib/agents/status.ts`) and are not fanned to phones. Inbound,
after the DO has stamped identity, is a `WireFrame` of kind
`inbound`, `react`, `ack`, or `pin`, with `user_id` set. Phone-facing
frames are the existing `WireFrame` from `lib/chat/frame.ts`.

`status` on this side carries `published` and `skipped` (`name`,
`reason`). `perf` carries optional `turn`, `source`, and `outcome`,
plus `tokens.prompt` and `tokens.completion`. `log` is one rate-capped
line: `level`, `message`, optional `at`, optional `dropped`. The field
lists the board already charts — the status JSON and the `perf` slog
line in [contract.md](contract.md) — stay the ones a finished turn
has to fill. The loop fills them on these kinds. The native
brain does not invent a second vocabulary, and it does not emit
`snapshot`. That frame belonged to the package that goes away.

---

## Package map

Go paths are `harness/internal/<name>` unless the row says otherwise.
Table names in SQLite stay the names the Go packages already use, so
a later import of `gantry.db` is a copy.

| Go | TypeScript | Wave |
| --- | --- | --- |
| `provider` | `brain/provider` | 1 |
| `session`, `here`, `selfnote`, `persona`, `slash` | `brain/session`, `brain/here`, `brain/selfnote`, `brain/persona`, `brain/slash` | 1 |
| `memory` | `brain/memory` | 1 |
| `aims` | `brain/aims` | 1 |
| `cron`, `examples` | `brain/cron`, `brain/examples` | 1 |
| `watch`, `websearch` | `brain/watch`, `brain/websearch` | 1 |
| `mcp` host and `mcpenable` enable rules | `brain/tools` | 1 |
| `harness/mcp/<name>`, twelve servers | `brain/plugins/<name>` | 1 |
| `agent` (the loop) | `brain/agent` | 2 |
| `channel/chat` and the `cmd/gantry` wiring | `brain/room` | 2 |

Persona and SELF.md live in SQL on the native path. `SELF.md` is the
`selfnote` row. Persona files are `persona_file` (`PERSONA.md`, then
any other `.md` name). The first native open copies `config.persona`
into `PERSONA.md` once; after that the row is the text. The brain
assembles those persona rows, then SELF.md from its own store. A
missing persona is still an empty standing identity. A container
agent keeps persona on the config frame the harness already receives.
The R2 `self_md` object goes away with the snapshot.

`slash` is the command catalog (`harness/internal/slash`): the list
the `cmds` frame publishes. Handlers stay next to the package that
owns the command; the catalog is one place.

Cron, examples, and watch share one alarm shape. The ticker goroutine
(`CRON_TICK_SECONDS`, a 15-second poll, and the watch poller on that
same ticker) becomes `nextDue()` and `fireDue()`. `nextDue` is the
soonest enabled row. The DO sets its alarm for that instant.
`alarm()` calls `fireDue`, which runs the job and arms the next
alarm. Cost between fires is zero, and the clock does not die when a
process stops. For a native agent the alarm runs the job. It does not
start a container. Job rows, `[silent]`, the daily planner, examples
pings, watch cursors, and push onto the current channel stay the
behavior in [cron.md](cron.md). Learned sleep, ask-first, and the
tool-first nudge on live-data jobs stay with the loop that `fireDue`
calls, which is `brain/agent`. The schedule tables and the due
calculation landed with wave 1; the loop runs the job.

`brain/tools` is the registry, the enable rules, the manifest drift
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
| `snapshot` | DO SQLite is durable on its own. Presigned PUT/GET, restore-on-boot, and the `snapshot` frame go away. An R2 export of the DO database is optional later. |
| `config` | Env is the DO's config map. There is no process environment to load. |
| `mcp` transport, `mcpenable` process half | Spawn, stdio, and any HTTP MCP client. Enable rules and the drift check are the `brain/tools` row above. |
| `channel/telegram`, `channel/discord`, `channel/slack`, `channel/stdio` | Later, and not one of the three waves. The three network channels come back as webhook routes on the Worker. A long-poll or a gateway socket is a process shape. `stdio` was a laptop mouth. |

`cmd/gantry` (`run`, `status`, `doctor`) is the container's
entrypoint. The native entrypoint is the DO. The wiring that turns a
room message into a turn moves to `brain/room`. `status` and `doctor`
go away with the binary.

The behavioral eval fixtures live under `brain/eval` (the same names
the Go tree used). `npm run eval` runs Vitest with
`vitest.eval.config.ts`. `eval.yml` calls that script. Setup:
[eval_setup.md](eval_setup.md). The Go tests under `harness/` stay the
frozen unit suite until that directory is archived.

---

## Plugins are plural

A tool call costs a turn. Every plugin tool takes a set — a date range
(`start`/`end`, or `days`), an id or name list, or a prefix — and returns
a list. One match is `[item]`. A miss on one item is a row (`{ id, error }`),
not a failed call. Omitting the argument means today, or the obvious
default. A tool that is inherently one thing (`account_get`, one room
face) sets `single` on its `ToolDef` and says why.

The rule is `.cursor/rules/brain-plugins-plural.mdc`. The checker is
`test/brain/plugins/plural.test.ts`.

---

## Waves

Waves 1 and 2 have landed (2026-10-11). The behavioral eval is on
Vitest (`npm run eval`, [eval_setup.md](eval_setup.md)). Wave 3's
cutover is open: flip each agent, the one-shot import, delete the
container classes, archive `harness/`. The list is [todo.md](todo.md).

| Wave | What lands |
| --- | --- |
| **1** | `brain/core` and every wave-1 row in the map, including all twelve plugins. Landed. |
| **2** | `brain/agent` (the loop), `brain/room` (the DO adapter), the per-agent `runtime` flag, and the `/auth <plugin>` OAuth catch. Landed. |
| **3** | Eval fixtures on Vitest (landed: `brain/eval`, `npm run eval`). A cutover walk. Flip each agent. Delete the container classes. Archive `harness/`. The cutover is open. |

A flip is the config field on one agent. The others keep their
container, their socket, and their R2 snapshot until their own flag
changes. Phones, the Tools grid, and the frame kinds do not change
on the day an agent flips.

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

## Data migration

An existing `gantry.db` in R2 is imported once into that agent's DO
SQLite by a one-shot admin operation. The ports keep the Go table
names, so the import is a copy into the schema `migrate` already
creates. The one-shot admin operation is still to build. Until an agent
flips, its durable brain is still the R2 snapshot the container
writes ([architecture.md](architecture.md#13-legacy-container-runtime)).

---

## What still describes the container

[architecture.md](architecture.md) §1–§5 are the native path. The
container pictures, including why that harness stayed Go, are
[§13](architecture.md#13-legacy-container-runtime). Choice 6 is
TypeScript for the product and Go frozen in `harness/` until cutover.
[cron.md](cron.md) arms the native alarm with `fireDue`. It does not
claim the alarm wakes a sleeping container: that wake was never built.
[runtime.md](runtime.md) stays the morning's record, including the
order this page cancelled. [contract.md](contract.md) still says
settings reads frames, does not open a live database, and does not sit
in a turn. The native writes (persona, `SELF.md`, runtime) are a
section at the top of that page.

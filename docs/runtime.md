# Where the agent runs — decision record

**Question.** The harness container for an agent gets stopped and
nothing wakes it. The owner wants an agent that is *active* — it talks
first, it keeps its own clock — and that is **not billed while idle**.
"Ideally it would be a Lambda, not a container." This page is the
morning's record of the container, of why Lambda lost, and of an order
that was cancelled later the same day. Decided 2026-10-11. Option C
is the brain in the tree; option A was not built. Record:
[brain.md](brain.md).

Pictures: native lifecycle in [architecture.md](architecture.md) §5,
container pictures in
[§13](architecture.md#13-legacy-container-runtime). The cron contract:
[cron.md](cron.md).

---

## What happens today

This section is `runtime: container`. A native agent's clock is the
Agent DO alarm (`brain.alarm()` / `nextAlarm()`), not a lease.

- `edge/harness.do.ts` set `sleepAfter = "2h"` (now `"15m"`, the
  stop-the-bleeding change of 2026-10-11; the rest of this section is
  still true of a container) on the
  `@cloudflare/containers` base class. That library's idle clock is
  reset only by requests **into the Harness DO** (`fetch`,
  `containerFetch`, `renewActivityTimeout()`). The harness's own work —
  its outbound socket to the Agent DO, turns, cron ticks, snapshots —
  never touches the Harness DO. So from the library's point of view the
  container is idle from the moment it starts, and fifteen minutes
  after Start it calls `onActivityExpired()` → `stop()` → "Container
  stopped" (exit 0, `reason: exit`). The only thing that keeps it up
  by accident is the agents board polling `info` while someone has the
  page open.
- Nothing wakes the container. The Agent DO does have `alarm()`: on
  `runtime: native` it runs the brain and arms the next wake; on
  `container` it returns without calling the Harness DO. The only
  start paths are the operator's Start and Recreate buttons
  (`lib/agents/container.ts`).
  - A phone `inbound` with no harness socket is queued
    (`lib/chat/route.ts` `persistRole`) and waits for a human to press
    Start. The Agent DO never pokes the Harness DO.
  - Cron lives inside the harness (SQLite `next_run`,
    `CRON_TICK_SECONDS`). When the process stops, the clock stops.
    The Agent DO does not learn that container's next job, and it does
    not start the box. [architecture.md](architecture.md#13-legacy-container-runtime)
    draws the container without a cron-start edge.
  - `webSocketClose` on the Agent DO notes the harness is gone. No
    restart and no backoff. The DO alarm is not a container restart.

So the container design is half-built, not wrong: the Agent DO owns
config, room, bearer, and container, and does not start the box for a
cron tick. Fifteen minutes of idle compute is the constant
`sleepAfter` chose. A native agent does not pay it.

## What the harness needs from a runtime

`harness/` is ~82k lines of Go: **~31k core** (`internal/` + `cmd/`)
and **~52k MCP servers** (`harness/mcp/`, twelve of them; `google` 17k
and `garmin` 16k are the big two). The core is a long-lived process
that:

- holds one outbound WebSocket to the room;
- keeps `gantry.db` (SQLite, `modernc.org/sqlite`) on local disk and
  snapshots it to R2 on SIGTERM, restores on boot;
- runs a 15-second cron ticker, watch pollers, the daily planner,
  example pings;
- **spawns MCP servers as stdio subprocesses** (`exec.Command` +
  `CommandTransport` in `internal/mcp/host.go`);
- calls any OpenAI-compatible endpoint (`internal/provider`, streaming).

The subprocesses and the local file are the two things that pin it to
"a process with a filesystem". Everything else is I/O.

---

## The three ways to stop paying for idle

| | Idle cost | Cold start | What changes |
| --- | --- | --- | --- |
| **A. Containers, scale-to-zero** | $0 while stopped. Containers bill per 10 ms **only while running**; the Workers Paid base ($5/mo) stays either way. | ~2–5 s image start + R2 restore | `sleepAfter` 15 min, lease renewed by harness activity, wake on message, wake on cron through a DO alarm. Harness barely changes. |
| **B. AWS Lambda** (container-image Lambda) | $0 | 1–5 s | Invert the harness: boot → pull db → spawn MCP children → **one turn** → HTTP-push reply/drafts/logs to the Worker → snapshot → exit. Cron via EventBridge Scheduler. 15-min hard cap per invocation. Second cloud: IAM, ECR, secrets twice, cross-cloud egress. Rewrites `internal/channel`; streaming has to be re-plumbed. |
| **C. Workers-native** | $0 | none — a Durable Object wakes in milliseconds | The brain runs *inside* the Agent DO in TypeScript. No process, no image, no socket between brain and room. Port of the ~31k core; MCP servers move to Streamable HTTP. |

B buys nothing on the stated goal — A and B are both $0 idle and both
cold-start in seconds — and costs a second cloud and a per-message
database download. Lambda *feels* right because it forces event-driven
wake; that is exactly the three pieces missing from A. **B is out.**

### Cost of A at the intended shape

Basic instance, 15-minute lease, ~20 wakes a day ≈ 150 h/month running
≈ **$3–4/month** of compute, much of it inside the Paid plan's included
allotment. The same instance 24/7 ≈ $20/month. (Unit prices from
Cloudflare's published Containers pricing; re-check the page before
budgeting.)

---

## A — Containers as a Lambda (days)

Three pieces, in order of payoff. Each is one agent's worth of work and
each is testable in Vitest + the Go suite.

1. **Lease, not timer.** `sleepAfter` → `15m`, read from an env var so
   the owner can tune it. Activity = harness traffic: the Agent DO
   forwards any harness-origin frame (`reply`, `draft`, `perf`, `log`,
   `cmds`) to the Harness DO as an `X-Harness-Op: touch` →
   `renewActivityTimeout()`. The harness's `heartbeat` package is a
   SQLite row for Docker healthchecks, not a frame — add a small
   `alive` frame on the same interval so a quiet-but-working agent
   (long tool loop, no output yet) still holds the lease. Override
   `onActivityExpired()` to refuse to stop while a turn is in flight
   (the DO knows: it saw `inbound` and no `reply` yet). The existing
   SIGTERM → snapshot drain saves memory on the way out.
   *Result: active conversation keeps it up; 15 minutes of silence and
   it is gone.*

2. **Wake on message.** Agent DO: phone `inbound` with no harness
   socket → debounce (~5 s; a burst is one start) → Harness `start`
   with the stored origin/bearer (the same spec the Start button
   sends) → `AgentStatus` gains a `waking` state the status fold shows
   as "waking…". The queue already replays on handshake, so the reply
   arrives one cold start later. A crash exit (`exitCode != 0`) gets a
   bounded backoff (1 m, 5 m, 30 m, then stop and surface `lastError`)
   so a bad config cannot loop-burn container minutes.

3. **Wake on cron.** The harness knows its `next_run`. It sends
   `next_wake: <epoch ms>` as a frame on handshake and whenever the
   schedule changes (`cron_schedule`, `cron_cancel`, planner, watch
   add/cancel, tick that fires). The Agent DO stores it and calls
   `ctx.storage.setAlarm(next_wake)`; `alarm()` starts the container
   if it is stopped and clears the alarm if it is running (the harness
   is the clock while up; the DO is the clock while asleep — the
   sentence [cron.md](cron.md) already promises). `@cloudflare/containers`
   has `schedule(when, method)` on the Harness DO, but the room,
   bearer, and status live on the Agent DO, so the alarm belongs
   there.

The morning's note, kept with this unbuilt step: correct
[architecture.md](architecture.md), [cron.md](cron.md), and
[contract.md](contract.md) if the lease lands. It did not. Those pages
now describe the native alarm. The container wake is still absent. The
two frames this step would have added, `alive` and `next_wake`, were
not added.

---

## C — Workers-native (weeks; the destination)

The brain becomes the Agent Durable Object. Cloudflare's primitives map
onto the harness almost one-to-one:

| Harness today (Go) | Workers-native | Notes |
| --- | --- | --- |
| `gantry.db` on container disk; snapshot/restore via R2 | **DO SQLite storage** | Durable by itself. `snapshot`, `drain`, restore, and the presigned-PUT plumbing go away. R2 export stays as an optional backup. |
| `cron` ticker, `watch` pollers, planner, examples | **DO alarms** — one alarm = next due row | Zero cost between fires. Crons cannot die with a process. |
| `provider` (openai-go) | `fetch` to the same URL, streaming | I/O wait does not count against CPU time. |
| `channel/chat` dialer | gone — the DO *is* the room | `reply` / `draft` / `log` become method calls. |
| `channel/telegram` long-poll, `discord` gateway, `slack` | Webhooks → Worker routes | All three support webhooks; this fits Workers better than a polling process. |
| `agent` loop, `memory`, `aims`, `persona`, `session`, `selfnote` (~12k) | Straight port | This is the product. The Go tests come across as the spec. |
| `heartbeat`, `logfwd`, `doctor`, `mcpenable`, most of `config` | Vanish | They supervise a process that no longer exists. |
| `goldmark`, `go-toml` | `marked`, `smol-toml` | Imports. |

Cloudflare's **Agents SDK** (`agents` on npm) is a DO subclass with
`this.schedule()` (alarms with cron syntax), `this.sql`, state sync,
hibernating WebSockets, and an MCP *client* manager. The hand-rolled
Agent DO either moves onto it or borrows from it — import over write.

Limits that matter and do not bite: 128 MB per isolate; CPU time 30 s
per invocation by default, up to 5 min on Paid (`limits.cpu_ms`) — an
agent turn is almost all I/O wait; 1,000 subrequests per invocation.

### The obstacle: MCP is stdio

A Worker cannot spawn a process, and all twelve servers are stdio
binaries. Each capability has to speak **Streamable HTTP** instead.

| Server | Lines | Path |
| --- | --- | --- |
| `google` | 17k | OAuth-heavy. Host behind HTTP; port last, or never. |
| `garmin` | 16k | MFA login flow. Same. |
| `strava`, `rentals`, `flights`, `google-health`, `maps` | 2–4k each | Host behind HTTP first; port when convenient. |
| `chat`, `image`, `feeds`, `math`, `twitter` | <1.3k each | Easy ports to `McpAgent` Workers. |

The cheap bridge: the Go MCP SDK already has a Streamable-HTTP
**server** transport, so every server runs unchanged as an HTTP service
behind **one shared, multi-tenant, scale-to-zero tool container** (or
Cloud Run). The brain goes Workers-native; the tools migrate one at a
time, smallest first. The per-agent container — the thing being paid
for — is gone on day one of that cut-over, and the tool container is
shared by every agent and sleeps between calls.

### What C buys

No cold start at all. Memory durable without the snapshot dance. Crons
that survive anything. Webhook channels. One platform, no image builds.
Multi-tenant economics for the hosted phase ([todo.md](todo.md)
Hosted): hundreds of agents are hundreds of DOs, not hundreds of
containers.

### What C costs

Porting ~31k lines of Go core (realistically 15–20k of TypeScript);
parity risk concentrated in `agent` / `memory` / `aims` / `persona`;
channels re-plumbed to webhooks; the MCP transport change; a period
with both runtimes alive. Weeks of focused agent work.

---

## Order

2026-10-11, later the same day: A cancelled, C chosen; see
[brain.md](brain.md). `sleepAfter` stays `"15m"` until cutover. The
rest of this section is that morning's order, kept as history.

A is step one of C, not a detour: its three pieces move the
scheduler's authority from the process into the DO, which is where C
needs it.

1. **A** — 15-min lease, wake on message, wake on cron via DO alarm.
   Idle bill drops to ~zero. Days.
2. **Tool container** — the twelve MCP servers over Streamable HTTP from
   one shared sleepy container; `internal/mcp/host.go` becomes an HTTP
   client (the SDK has the transport). Nothing per-agent needs a
   process except the brain.
3. **Brain port** — into the Agent DO, package by package, Go tests as
   the spec, behind a per-agent flag so one agent can run native while
   the rest stay on the container. Per-agent containers deleted when
   the last agent flips.

That morning's decision, kept here: A then C.
[brain.md](brain.md) cancelled it. Not decided that morning: when step
2 starts. Step 2 was cancelled with A. The brain that landed is
in-process plugins, not a tool container.

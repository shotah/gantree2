# Where the agent runs — decision record

**Decided 2026-10-11.** The question was an agent that talks first,
keeps its own clock, and is not billed while it waits. The answer is
the TypeScript brain inside the Agent Durable Object. Record:
[brain.md](brain.md). Pictures: [architecture.md](architecture.md) §5.
The clock: [cron.md](cron.md).

The morning's lease, the Lambda comparison, and a process clock are
not the product. This page stays so that order is not reopened.

## Status

Settings reads `GET /api/agents/<agent id>/status`. The Agent DO computes
it from the brain running in that object.

`state` is `ready`, `needs_keys`, `error`, or `starting`. `since` is
the last time the brain opened, in epoch milliseconds. `version` is
`PACKAGE_VERSION` (`app/lib/release.ts`). `lastTurnAt` is the last
finished turn. `plugins` is the registry boot list: each name is
`ready` or `skipped`, and a skip carries `reason` (`no_key`,
`disabled`, `no_oauth`, `error`). `perf` and `lastError` are the same
counters as before. `published`, `skipped`, and `lastTurn` stay on
the JSON so a reader that already uses them keeps working.

`POST /api/agents/<agent id>/restart` drops the memoised brain and opens
a new one, the same work a fresh isolate does on its first call. The
gate is the other agent routes: an admin, or an operator who can run
that agent id.

A skip for a missing key or a plugin that is off is an info log,
`plugin skipped`, with `plugin` and `reason`. A plugin that fails to
load stays an error. `status`, `perf`, and `log` frames still stay
off the phone sockets.

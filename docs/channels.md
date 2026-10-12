# Channels

The mouth this product runs is **chat**. The harness is the Agent
Durable Object, and the phone joins that room. Cab and helm are native
apps on that same room, not a second channel. Android Auto is one
surface of cab. Their backlog is not in this repo
([todo.md](todo.md) §0). Pictures:
[architecture.md](architecture.md).

The DO fans `reply`, `draft`, `typing`, `react`, `cmds`, `aims`,
`todo`, `allow`, and `push` to the phones on the room list. `status`,
`perf`, and `log` stay on the DO.

Telegram, Discord, and Slack are not ported. That is an open item.
Stdio is not a mouth.

Allowlist grammar: [access.md](access.md#allowlist-entry-grammar).
The chat PWA is this repo.

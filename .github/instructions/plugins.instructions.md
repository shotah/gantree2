---
applyTo: "brain/plugins/**"
---

# Plugin tools

A tool call costs a turn. Every tool thinks in sets.

Input accepts a set. Dates take `start`/`end` or `days`, or a list.
Ids and names take a list. Lookups take a prefix or a pattern. The
single field stays accepted. Omitting the argument means today, or
the obvious default, never an error.

Output is a list. One match comes back as `[item]`. A miss on one item
is a row (`{ id, error }` or `{ date, error }`), not a failed call.

Keep the Go name and the Go fields. Extend `inputSchema` by adding
fields. `date` stays when you add `start`, `end`, or `dates`. Prompts
and eval fixtures key on the names.

Cap the list. `limit`, a sane default, and a max written in the
description. One call must not blow the context.

A tool that is inherently one thing (`account_get`, `*_create` of one
record) sets `single` on the `ToolDef` to the reason. Anything else
that is neither plural nor annotated fails
`test/brain/plugins/plural.test.ts`.

Register the tool as `{service}_{verb}_{object}`. The host name is
`{plugin}__{tool}`, prefixed in `brain/tools`. The registered name
does not repeat the plugin id. Verbs prefer `list`, `get`, `search`,
`create`, `update`, `delete`, `format`. See `docs/mcp-naming.md`.

Prefix SQL tables with the plugin name (`strava_token`). Read env.
Logs do not include env values. `ready` returns `null` when the plugin
can serve, or `no_key`, `no_oauth`, `disabled`, or `error`.

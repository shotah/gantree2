# Settings contract

What settings may **write** and **read**. Settings never sits in a chat
turn. Settings does not open the live database. If a field is not on
this page, do not invent a hook for it.

Pictures: [architecture.md](architecture.md). Who may edit:
[access.md](access.md).

The brain emits `status`, `perf`, and `log`. The DO folds them
(`lib/agents/status.ts`). `status` is `published` and `skipped`
(`name`, `reason`).

---

## What settings may write

The Agent DO is the disk. The brain reads that DO.
[architecture.md](architecture.md).

| What | Where | Who |
| --- | --- | --- |
| `PERSONA.md` | `persona_file` | admin / operator, persona fold. First open copies `config.persona` once if the table is empty and the text is non-blank |
| `SELF.md` | `selfnote` | the agent, and the operator on the self fold |
| Grants | the registry | admin / operator, Tools fold. A plugin left off the list is not in the catalog |
| `config.env` | DO config | admin / operator. A change drops the memoised brain and opens a new one |
| OAuth tokens | `oauth_token`, AES-256-GCM | the plugin, via `authFinish`. Key is `snapshot.key` |

Routes: `GET` / `PUT` / `DELETE /api/agents/:slug/persona` and
`GET` / `PUT /api/agents/:slug/self`.

---

## Env settings may write

Required for a talking agent:

| Key | Role |
| --- | --- |
| `LLM_BASE_URL` | OpenAI-compat endpoint |
| `LLM_API_KEY` | Provider key |
| `LLM_MODEL` | Model id |

House copies of those three, plus `BRAVE_SEARCH_API_KEY`, live on the
Worker. An agent's `config.env` wins when the same name is set on both.

Plugin keys (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`,
`STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`, `GARMIN_EMAIL` /
`GARMIN_PASSWORD`, `GOOGLE_MAPS_API_KEY`, `X_BEARER_TOKEN`, and the
rest each plugin's `ready()` checks) are `config.env`.

| Key | Role |
| --- | --- |
| `GARMIN_TOOL_TIER` | `core` (empty), `extended`, `complete` |
| `GOOGLE_TOOL_PRESET` | `everyday` (empty), `lean`, `all` |
| `CRON_TZ` | local zone for jobs and the planner |
| `DAILY_PLANNER_AT` | local `HH:MM`, default `07:10` |
| `MEMORY_CONSOLIDATE_MINUTES` | consolidation period, default 30; `0` turns that pass off |
| `DYNAMIC_TOOLS` | `true` (empty) keeps schemas off until `mcp_enable`; `false` publishes the catalog every turn |
| `MCP_ENABLE_FORCE` | comma-separated prefixes that stay on while dynamic tools are on |
| `PUBLIC_ORIGIN` | host for the OAuth catch, no path ([auth.md](auth.md)) |

---

## `status`

```json
{
  "kind": "status",
  "published": ["math", "feeds"],
  "skipped": [{ "name": "google", "reason": "no_oauth" }]
}
```

Skip reasons: `no_key`, `no_oauth`, `disabled`, `error`.

---

## Ledger tables

Read-only from the board. They live in the Agent DO's SQLite. The
`status` frame does not grow a field for them. Settings does not open
the live database.

`day` is a local `YYYY-MM-DD` in `CRON_TZ`. Live rows are
`superseded_by IS NULL`. `score` is the agent's opinion `-3…+3`, not a
grade. The day score is `SUM(score)` over live rows for one (area, day),
clamped to `[-3, 3]`.

| Table | Columns |
| --- | --- |
| `aim_event` | `id`, `day`, `what`, `ref`, `metric`, `value`, `unit`, `source`, `created_at`, `superseded_by` |
| `aim_score` | `event_id`, `area`, `score`, `note` |
| `aim_block` | `area`, `from_day`, `to_day` |

Do not chart superseded rows or `aim/bootstrap`. Weeks, slope, and
Pearson are derived.

The human's tasks are `memory` rows with
`kind = 'fact' AND subject LIKE 'todo/%' AND superseded_by IS NULL`.
Done rows are deleted.

## Tool errors (model + UI)

A skipped plugin stays out of the prompt catalog. If the model still
calls that prefix:

```text
tool error [no_oauth]: google is skipped (…) — do not invent google__* names
```

Classified key or oauth failures use `tool error [<reason>]:`.
Anything else stays `tool error: …`.

---

## `perf` and `log`

Turns ride the `perf` frame. Other lines ride the `log` frame,
rate-capped.

`source` is `user`, `cron`, `watch`, or `reaction` (other strings
chart as spend unknown; the daily planner and examples are `cron`).
`user_id` is required on `user` and `reaction`; cron and watch omit it
when empty. Also: `session_id`, `outcome`, `iterations`, `tool_calls`,
`max_batch`, `recoveries`, `tools_per_inv`, `prompt_est_tokens`,
`gen_est_tokens` (chars/4 fallback), `model_ms`, `tool_ms`,
`total_ms`, `duration_ms` (same wall ms as `total_ms`),
`hydration_est_tokens`, `model`, `finish_reason`.

A reaction the kernel settles without a model call logs one line:
`outcome=silent`, `iterations=0`, token and ms counts 0, no
`finish_reason`. Chart it as a free turn.

When the provider sent usage (summed across rounds): `tokens.prompt`,
`tokens.completion`, and when present `total_tokens`, `usage_rounds`,
`cached_tokens`, `cache_write_tokens`, `reasoning_tokens`,
`prompt_audio_tokens`, `completion_audio_tokens`,
`accepted_prediction_tokens`, `rejected_prediction_tokens`,
`service_tier`.

Chars/4 estimates stay on `*_est_tokens`. Provider counts are the
`tokens` object when present. Workers Logs / celld tails are the long
tail, not a second contract.

---

## Not this contract

- No listen port, `/metrics`, or scrape endpoint
- No slug inside the brain
- No settings write path on model rounds or tool fan-out

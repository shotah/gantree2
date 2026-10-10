# Settings contract

What settings may **write** and **read** against the harness. Settings
never sits in a chat turn. The harness never learns a slug. If a field
is not on this page, do not invent a hook for it.

Pictures: [architecture.md](architecture.md). Who may edit: [access.md](access.md).

---

## Speed

`status` is a frame on the socket the harness already opened. It carries
the same JSON `gantry status` prints. Settings does not exec into the
container. No scrape, no port.

The binary's `gantry status` / `gantry doctor` (read-only SQLite, `stat`
the persona files, parse `mcp.toml`, read `doctor.json`, never dial MCP,
never load LLM env, never write) still exists for a laptop run. The tree
lands with [todo.md](todo.md) §5. The board reads the frame.

`doctor.json` is written **once** after MCP boot, not per tool call.
Heartbeat Touch stays a one-row upsert on its existing interval.

`alive: true` is **liveness** (heartbeat fresh). Chat with an empty
manifest, or a listed manifest that all skipped, must not recreate the
container. `ok: false` with `reason: mcp_all_skipped` is health, not a crash.

---

## What settings may write

The Agent DO is the disk. Settings edits it; the harness reads it at
boot. [architecture.md](architecture.md).

| On the DO / in the container | Env the process reads | Who writes | Notes |
| --- | --- | --- | --- |
| `config.persona` | `PERSONA_DIR` (`PERSONA.md`) | admin / operator | Required standing identity. Missing is tolerated at boot (empty persona). |
| `SELF.md` on container disk, and in the R2 snapshot | `PERSONA_DIR` | the agent | Settings may show / prune the snapshot; do not invent MCP catalogs here. |
| `config.mcp` | `MCP_MANIFEST` | admin / operator | Same TOML. `[[server]]` listed = granted. Omit = does not exist. Sent on the `config` frame. |
| `gantry.db`, OAuth session files, `doctor.json` | `DATA_DIR` | process | Never copy between agents. Durable brain is the R2 snapshot of `gantry.db` + `SELF.md`. OAuth files are refused from that stamp. |
| `config.env` | process env | admin / operator | Secrets. MCP children inherit this env. Env change recreates. |

`mcp.toml` fields settings writes: `name`, `command`, `args`,
`auth_args` / `auth_command`, `tools`, `exclude`, `tools_prefix`, `force`,
`budget`. `dynamic_tools` is the manifest-level switch
([mcp.md](mcp.md)). `download_url` / `download_tag` are dropped —
nothing is fetched at agent start ([custom-mcp.md](custom-mcp.md)).

OAuth session files are server-specific (often under `DATA_DIR`, or a
path in `auth_args`). The harness does not invent those names. They are
refused from the R2 stamp. Whether the DO keeps them across a recreate
is not in [architecture.md](architecture.md). The hop is [auth.md](auth.md).

---

## Env settings may write

Required for a talking agent (fail-fast at `gantry run`):

| Key | Role |
| --- | --- |
| `LLM_BASE_URL` | OpenAI-compat endpoint |
| `LLM_API_KEY` | Provider key |
| `LLM_MODEL` | Model id |
| `CHANNEL` | `telegram` (the binary default) · `discord` · `slack` · `chat` · `stdio` |
| Channel token + allowlist | Empty allowlist fails boot. On chat the DO injects `CHAT_BEARER` and settings may write emails into `CHAT_ALLOWED_USERS`. There is no mailbox URL to paste. |

Optional knobs (history, tools, memory, cron, watch, daily planner, stream)
live in `harness/.env.example` (lands with [todo.md](todo.md) §5). Do not
add a second settings API. MCP API keys (`GOOGLE_*`, `X_BEARER_TOKEN`, …)
are process env the child inherits — not harness knobs.

`gantry status` reads only `DATA_DIR`, `PERSONA_DIR`, `MCP_MANIFEST`,
`CHANNEL` (with the same defaults as `run`). It does **not** call
`config.Load()`, so a laptop status never needs the LLM key. The frame
the board reads is that same JSON.

---

## `status` JSON

One JSON object, on the `status` frame and on `gantry status` stdout.
Stderr may add `status: <reason>` when not alive.

```json
{
  "alive": true,
  "ok": false,
  "reason": "mcp_all_skipped",
  "version": "0.1.70",
  "commit": "b2f7cfe",
  "channel": "chat",
  "persona": { "dir": "/persona", "persona_md": true, "self_md": false },
  "mcp": {
    "listed": 2,
    "connected": 0,
    "skipped": 2,
    "servers": [
      {
        "name": "google",
        "state": "skipped",
        "reason": "no_oauth",
        "note": "oauth token missing",
        "auth": true
      }
    ]
  }
}
```

| Field | Meaning |
| --- | --- |
| `alive` | Heartbeat row fresh (≤ ~60s). |
| `ok` | Health for the board. False when `alive` is false, or listed MCP are all skipped / none connected. Empty manifest (chat-only) stays `ok` if alive. |
| `reason` | `no_heartbeat` · `mcp_all_skipped` |
| `version` | Harness semver from the binary ldflags (`gantry version`). Present even when `alive` is false — same image, same stamp. The image tag settings pins is not this. |
| `commit` | Short git sha when the image was built (`none` omitted) |
| `mcp.servers[].state` | `connected` · `skipped` · `unknown` (no boot snapshot yet) |
| `mcp.servers[].reason` | `no_binary` · `no_key` · `no_oauth` · `connect` |
| `mcp.servers[].auth` | `mcp.toml` declared `auth_args` / `auth_command` |

Parse JSON. Do not regex the line for `ok` / `skipped` — `"ok":false`
contains the letters `ok`. The card turns green from the container
binding together with this frame ([architecture.md](architecture.md)).

---

## Ledger tables

Read-only. They live in `gantry.db`. There is no hook inside the process,
and the `status` JSON does not grow a field for this. The board does not
open the live file; the durable copy is the R2 snapshot. Live charts of
these rows wait on that snapshot. Write-through to DO SQLite is later
([architecture.md](architecture.md#12-later-and-not-the-product)).

`day` is a local `YYYY-MM-DD` in `CRON_TZ`. Live rows are
`superseded_by IS NULL`. `score` is the agent's opinion `-3…+3`, not a
grade. The day score is `SUM(score)` over live rows for one (area, day),
clamped to `[-3, 3]`. The aims write-up is not carried.

| Table | Columns |
| --- | --- |
| `aim_event` | `id`, `day`, `what`, `ref`, `metric`, `value`, `unit`, `source`, `created_at`, `superseded_by` |
| `aim_score` | `event_id`, `area`, `score`, `note` |
| `aim_block` | `area`, `from_day`, `to_day` |

Do not chart superseded rows, `aim/bootstrap`, or a correlation the
harness did not stamp. Weeks, slope, and Pearson are derived. Recompute
them if a chart needs them. Do not add a fourth table.

The human's tasks are not a table either: they are `memory` rows with
`kind = 'fact' AND subject LIKE 'todo/%' AND superseded_by IS NULL`.
Done rows are deleted, so there is no done history to chart. The tasks
write-up is not carried.

## Tool errors (model + UI)

Boot-skipped servers stay out of the prompt catalog (do not invite
invention). If the model still calls that prefix:

```text
tool error [no_oauth]: google is skipped (…) — do not invent google__* names
```

MCP `isError` results that classify as key/oauth/binary use the same
`tool error [<reason>]:` shape. Generic failures stay `tool error: …`.

---

## Slog settings may read

JSON. Turns ride the `perf` frame (the same line). Other lines ride the
`log` frame, rate-capped. [architecture.md](architecture.md).

`msg=turn perf` → `source` (`user` · `cron` · `watch` · `reaction`; **always
set** — other strings chart as spend unknown; daily planner / examples are `cron`),
`user_id` (required on `user` / `reaction`; cron/watch omit when empty),
`session_id`, `outcome`, `iterations`, `tool_calls`, `max_batch`, `recoveries`,
`tools_per_inv`, `prompt_est_tokens`, `gen_est_tokens` (chars/4 fallback),
`model_ms`, `tool_ms`, `total_ms`, `duration_ms` (same wall ms as `total_ms`),
`hydration_est_tokens`, `model`, `finish_reason`.

A `reaction` turn the kernel settles without a model call (their 👍 on a
done message) still logs one line: `outcome=silent`, `iterations=0`, all
token and ms counts 0, no `finish_reason`. Chart it as a free turn, not a
gap.

When the Completer response had OpenAI-compat `usage` (summed across rounds):
`prompt_tokens`, `completion_tokens`, `total_tokens`, `usage_rounds`, and when
the provider sent them: `cached_tokens`, `cache_write_tokens`,
`reasoning_tokens`, `prompt_audio_tokens`, `completion_audio_tokens`,
`accepted_prediction_tokens`, `rejected_prediction_tokens`, `service_tier`.

Do not scrape these with a hook inside the process. The frames are pull.
Chars/4 estimates stay on `*_est_tokens`. Native `prompt_tokens` /
`completion_tokens` / `total_tokens` are the provider counts when present.
Workers Logs / celld tails are the long tail, not a second contract.

---

## Not this contract

- No listen port, `/metrics`, or scrape endpoint on the harness
- No slug inside the harness
- No settings write path on Completer rounds or tool fan-out
- No `docker.sock`, no bind mount, no log scrape

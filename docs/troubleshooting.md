# Troubleshooting

> Pitch: [../README.md](../README.md) · Contract: [contract.md](contract.md)

Fixes for common “why is it doing that?” moments. Prefer the `log` frame
(`self-notes disabled`, `self distill`, `TOOL_MAX_ITERATIONS`) before
rewriting persona. Long-horizon personality lives in `SELF.md` — prune it
like you would a friend’s inside jokes. Writing a tight `PERSONA.md` (no MCP
catalog, north-star vs tracker): [persona.md](persona.md). Horizon split:
[persona.md](persona.md#where-the-horizon-lives).

The files below live on the container disk. The durable copy of
`gantry.db` and `SELF.md` is the R2 snapshot.
[architecture.md](architecture.md). Settings does not open the live
files, and there is no sock to exec through.

## `SELF.md` — personality drift

The harness’s **self-notes** feature is long-horizon personality: the agent grows
a voice that survives `/new`. That is harness work, not a plugin.

- Boot / SIGHUP: the harness overwrites the `SELF.md` header and the `PERSONA.md` Self-notes and Location pins sections. Your bullets stay.
- Mid-chat: builtin `self_note` appends a short line to `PERSONA_DIR/SELF.md`.
- On history trim: new `Voice:` bits append the same way (no extra model call).
- On `/new`: a distill pass **merges** into the file from the dying session,
  the rolling `Voice:` block, and existing notes. Quoted jokes that the model
  drops are restored. A bland session (no `Voice:`, no quoted bits) leaves
  `SELF.md` as-is. Session `Facts:` park in SQLite memory — not `PERSONA.md`.
- Loaded every turn as part of the persona (after `PERSONA.md`). Cap ~4KB.

That is the feature — and the footgun. Notes reinforce themselves: a snarky
line becomes “who I am,” then the next distill keeps it. **You own the veto.**

### When to audit

Open `SELF.md` (or wipe it) when:

- The agent feels wrong after a reset — too clingy, too snarky, off-brand jokes
- It keeps referencing a game / nickname / bit you are done with
- **Near-duplicate bullets pile up** (agent treated `self_note` like a rewrite —
  prune dupes; persona should say append-only + skip-if-already-there)
- A long tool-heavy or argumentative session just ended and `/new` distilled
  anyway (Voice or quotes were present) — prune if the mood locked in
- **Do not `/new` a bland session to “get him back.”** Distill skips when there
  is no `Voice:` and no quoted bits, but prune `SELF.md` first if it is already
  vibe-words instead of jokes.
- **Progress logs / mileage / open loops in `SELF.md`** — that is the tracker.
  One north-star sentence can stay; the rest is `memory_store` (`aim/<area>`).
  See [persona.md](persona.md#where-the-horizon-lives).
- You shared the allowlist with someone else and want a clean slate for them

### How to fix

`SELF.md` sits beside `PERSONA.md` (`PERSONA_DIR`) on the container disk.
The copy you can keep is the R2 snapshot (`backups/<slug>/<stamp>.tar`),
same stamp as `gantry.db`. Unpack it, prune, restore that stamp, recreate.

`SELF_NOTES_ENABLED=false` in `config.env` disables `self_note` and
distill. Env change recreates. A persona dir the process cannot write
has the same effect — boot logs `self-notes disabled`. There is no
read-only bind mount. Native SIGHUP deploys are not carried; the process
still reloads persona on `self_note`, distill, or recreate.

| Action | Effect |
| --- | --- |
| Delete specific `-` lines in the snapshot you restore | Surgical prune; next turn loads the shorter file |
| Truncate to header only / delete file | Fresh personality; next `/new` can grow it again |
| `SELF_NOTES_ENABLED=false` | Disables `self_note` + distill |
| Persona dir not writable | Same as disable — boot logs `self-notes disabled` |

After a prune, the running process still has the old persona in memory until:

- The next `self_note` / distill (reloads persona after write), or
- Container recreate

A hand edit of a stamp is not live until that stamp is restored.

### Sell vs safety (read both)

**Why keep it on:** without `SELF.md`, the “funny agent” lives only in
chat history. `/new` or a context blow-up lobotomizes them. Self-notes
are how ownership means *continuity*, not just *control*.

**Why audit:** the agent cannot violate `PERSONA.md` by design of the prompt,
but tone and rituals are soft. Undesirable personality is an ops problem —
treat `SELF.md` like a log you review, not a sacred file you never open.

The door's threats are in [access.md](access.md#threats). The harness
threat-model write-up is not carried.

## Self-notes silently off

**Symptom:** `/tools` has no `self_note`; `/new` always says plain
`session reset` (never “personality distilled…”); boot log has
`self-notes disabled (persona dir not writable)`.

**Cause:** `PERSONA_DIR` is not writable.

**Fix:**

1. The container user must be able to write `PERSONA_DIR`. `GANTRY_UID` /
   `GANTRY_GID` were compose knobs; they are not carried.
2. Or set `SELF_NOTES_ENABLED=false` in `config.env` if you want
   self-notes off on purpose. Env change recreates.

## Agent “forgot” who it was after `/new`

**Expected without self-notes:** session history + rolling summary are wiped;
only `PERSONA.md` remains → bland reboot.

**With self-notes enabled + writable persona:** `/new` should reply
`session reset — personality distilled into SELF.md` after a session that
has a `Voice:` line or quoted jokes in the transcript. A bland tool session
returns plain `session reset` and **leaves `SELF.md` alone**. Check:

1. Boot log: self-notes ready vs disabled.
2. `SELF.md` after `/new` — did quoted jokes survive? If the file is
   vibe-words (`dry`, `sarcastic`) and not quotes, prune it; another `/new`
   will not grow those back. The durable copy is the next snapshot.
3. Distill is best-effort: if the LLM call fails, reset still happens and the
   log shows `self distill: … failed`. Personality from that session is lost;
   prior `SELF.md` content is kept. Dropped quotes are restored when the
   model returns a file that omitted them.
4. `/tokens` prints `Voice: yes` or `Voice: (none)` next to `summary`.

## Agent keeps calling tools forever / burns tokens

Default tool budget is `TOOL_MAX_ITERATIONS=15` tool rounds, then a **landing
call with tools withheld** so the turn ends in a real reply (and history is
saved) instead of an error that drops the work. A soft warning fires around
70% of the budget. If the model still asks for tools on the landing call, the
turn lands on a plain "ran out of tool calls" reply (log:
`model emitted tool calls on the landing call`) rather than erroring the
channel with "something went wrong".

If you still see anonymous `✓ ✓ ✓ …` with no narration, check `TOOL_TRACE`
and whether the model is emitting a one-line reason before the **batch**
(persona + kernel note ask for independent calls in one response). Serial
3-tools-per-round over twenty Completer calls re-bills the standing prompt
each time — `/perf` `iters` / `tools` / `batch` / `rec` is the tell. Raise
or lower the round budget via `config.env`. The knob list is
`harness/.env.example` (lands with [todo.md](todo.md) §5).

## Inspect memory (`sqlite3`)

Builtin memory is `gantry.db` under `DATA_DIR` on the container disk.
Same file as sessions, cron, heartbeat. The durable copy is the R2
snapshot. Unpack a stamp, then:

```bash
sqlite3 gantry.db
PRAGMA journal_mode;   -- expect wal
```

```sql
SELECT id, kind, subject, content, source, created_at, expires_at, superseded_by, consolidated
FROM memory
WHERE superseded_by IS NULL
  AND NOT (kind = 'episode' AND consolidated != 0)
  AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ORDER BY updated_at DESC
LIMIT 50;

SELECT m.id, m.kind, m.subject, m.content
FROM memory_fts
JOIN memory m ON m.id = memory_fts.rowid
WHERE memory_fts MATCH '"ada" OR "climbing"'
  AND m.superseded_by IS NULL;

DELETE FROM memory WHERE id = 42;
```

A delete in an unpacked stamp is not live until that stamp is restored
and the container recreates. Write-through to DO SQLite is later
([architecture.md](architecture.md#12-later-and-not-the-product)).

FTS triggers keep `memory_fts` in sync. `/new` clears `session_message` for
that chat; it does **not** touch `memory`.

| kind | typical TTL | notes |
|------|-------------|--------|
| `episode` | 30 days | consolidator reads these |
| `fact` / `preference` / `person` / `insight` | none | hydrated. Months-scale plans: `insight` / `aim/<area>` |

`consolidated = 1` means processed (hidden from hydrate). `= 2` is quarantined
after parse failures. Same `kind+subject` on a durable store supersedes the
old live row. `pref/hours` is the sleep/work/quiet stamp (`[hours]` on every
turn). The memory-design write-up is not carried. This table is the row
contract.

## More

| Topic | Doc |
| --- | --- |
| MCP name / auth failures | [mcp.md](mcp.md) · [auth.md](auth.md) |
| Slow local turns | `LLM_BASE_URL` on that agent. Native GPU deploys are not carried. |
| Who may talk | [access.md](access.md) |

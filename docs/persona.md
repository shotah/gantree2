# Persona files

> Pitch: [../README.md](../README.md) · What settings may write: [contract.md](contract.md) ·
> Grown personality: [troubleshooting.md](troubleshooting.md#selfmd--personality-drift)

Two markdown texts. That is the whole standing prompt besides memory
hydration, history, and **this turn’s tool schemas**.

| File | Who writes it | Job |
| --- | --- | --- |
| `PERSONA.md` | You | Who the agent **should** be, who you are, builtin policy |
| `SELF.md` | The agent (`self_note`, distill on `/new`) | Who it **became** with you — voice, jokes, rituals, a few north-star aims |

The prompt concatenates them in that order. The brain stamps the
**Self-notes**, **Location pins**, and **Follow-up** sections in
`PERSONA.md` and the `SELF.md` header. Your bullets stay.

Both are SQLite rows in the Agent DO. `PERSONA.md` is a
`persona_file` row. `SELF.md` is the `selfnote` row. The first open
copies `config.persona` into `PERSONA.md` once, and only when
`persona_file` is empty and the text is non-blank. That copy does not
run again once any row exists. Saving the persona fold writes the row.
A `PATCH` of `config.persona` also writes `PERSONA.md` when the string
changes. The dashboard folds and the HTTP routes are the edit path:
`GET` / `PUT` / `DELETE /api/agents/:slug/persona` and
`GET` / `PUT /api/agents/:slug/self`. Other `*.md` names can be stored;
the assembler uses `PERSONA.md` and `SELF.md`. If `PERSONA.md` is
absent, leftover `SOUL.md` / `RULES.md` / `USER.md` / `TOOLS.md` are
folded into it. [architecture.md](architecture.md).

---

## MCP tools are not this file

Loaded MCP servers reach the model from the **live catalog**:

- Tool schemas on the model call (the granted catalog, then `mcp_enable`)
- `[mcp prefixes]` in the prompt when dynamic tools are on — the model is
  told to review on vs off and `mcp_enable` a needed off prefix this turn
- `/tools` for you

Do **not** copy `google__…` / `garmin__…` / routing tables into `PERSONA.md`.
That file is in the cached prefix every turn. If Google is not mounted, a
persona that names `google__calendar_list_events` teaches the model to invent
a tool. If Google *is* mounted, the schema already has the name.

`PERSONA.md` may mention builtins (`self_note`, `memory_*`, `cron_*`,
`watch_*`, `mcp_enable`) and **your** facts the schema cannot know (timezone,
canonical email, “ask first”). House notes (“bike = bicycling”) belong under
**About you**, not as a fake catalog.

Wiring tools: [mcp.md](mcp.md).

---

## Where the horizon lives

Long-horizon planning is not one file. Mixing a marathon log into `SELF.md`
is the same overspill as putting MCP recipes in `PERSONA.md`.

| Layer | Always in the prompt? | Holds |
| --- | --- | --- |
| `SELF.md` | Yes (cap ~4KB) | Who you became: voice, jokes, rituals, **3–5 north-star sentences** that change how you show up for months. Not mileage, due dates, or this week’s open loops. |
| SQLite memory | Hydrate ≤ ~30 rows (FTS + recency; `insight` sorts last). **`[hours]`**, **`[aims]`**, **`[todo]`**, and **`[loops]`** are also stamped on every turn from `pref/hours`, live `aim/<area>` insight, `todo/` facts, and `waiting/` `follow/` facts — they do not depend on the hydrate query, and stamped rows are not repeated in `[memory]`. Loops untouched for three weeks carry `— resolve or memory_forget`. Tasks never do: the agent keeps the list, only the human closes one (`memory_forget` by the `#id` on `[todo]`). | The tracker. `aim/<area>` insight; `pref/food` `pref/hours` preference (same subject replaces the live row); `event/` `todo/` `waiting/` `follow/` fact. |
| cron / watch / daily planner | No — wakes a later turn | The loop. One clock time plans the day (aims, live tools, one question). Pin a wake with `cron_schedule` `memory_subject` (or `memory_id` when the row already exists). User crons still fire at the time they picked; example pings skip learned sleep. |
| Calendar / Tasks (MCP) | No | Dated to-dos with a real due date. |

**Not all SQL.** Hydration is still lossy for arbitrary facts. Live `aim/`,
`todo/`, and `waiting/` / `follow/` rows are also stamped on `[harness]`
every turn (cap 5 each), so the tracker does not depend on this week's
chat query.
A north-star sentence in `SELF.md` is the always-on personality layer.

**Not all `SELF.md`.** Distill treats notes like personality. Progress needs
forget / FTS / supersede. Jokes competing with project plans is mystery
blending again.

No new `goal` kind. `insight` + `aim/` is the convention. The new-agent
template teaches this: `app/components/agents/personaTemplate.ts`.

---

## Writing `PERSONA.md` (keep it tight)

Context is an **attention budget**. Long prompts rot in the middle — the model
follows the first lines and the last, and quietly drops the handbook in
between ([Anthropic, context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
A 16k-character file that restates “don’t bluff” three times is worse than a
3k file with two examples.

**Budget:** aim **2–4k characters** on disk (~500–1k tokens). Kernel stamps add
a bit more at boot. Past that you are competing with history for attention —
and the whole prefix is **re-billed every Completer round**, so a fat persona
makes serial tool loops even more expensive. Personality that stays short
still steers a long chat; a wall of rules becomes background noise around
message 20.

**Altitude:** specific enough to change behavior, not a brittle if-else dump
and not “be helpful.” Testable always/never beats vibes. “2–4 sentences, answer
first” beats “be concise.”

**Examples over edge-case lists.** Two or three canonical shots teach more than
forty rules:

```text
“what’s on today?” → calendar + mail + memory_recall in ONE response
(independent lookups), then two sentences. Never a fake empty calendar.
Never serial calendar-then-mail. A real empty day is a hole: ask what they
want on it (lunch/dinner or training) — get something scheduled. Don’t just
report nothing. They taught that loop → store it and ask **this turn**,
never “yes boss.”
“how’s the long goal going?” → recall `aim/` then live tools. Never invent
progress.
“[cron] Daily planner” → one session. `[aims]` / `[hours]` / `[wakes]` are already in
`[harness]`; calendar, mail, and Garmin in ONE response, then today’s crons.
Sick or vacation → `[silent]`. Real empty calendar → one question: what do
they want on it. A clock time she commits (scoop at 2) → `cron_schedule`.
Hours unknown: ask sleep/work once. `[silent]` if nothing useful.
A running joke → quote SELF.md. Don’t paraphrase it.
```

Diverse: one task, one **horizon** (`aim/` recall *and* the daily planner as the autonomous
wake), one voice. Don’t add an example that only restates a bullet you already wrote.

**Shape that works** (what each section is for and what must never be cut:
[persona_doc_goals.md](persona_doc_goals.md)):

1. Identity + voice (who, how it talks)
2. **Goals** — get the aim, nudge where today's tools disagree with it, do
   the legwork — then a few examples (include one long-horizon recall)
3. Hard do/don’t (tools-first, **Prefer parallel tool calls**, identity lock, ask-first)
4. **Memory hygiene** — the three-layer split (north-star / tracker / wake).
   Keep that section; do not grow it into a project plan. Kernel stamps
   Self-notes + Location pins.
5. **About you** (timezone as `- **Timezone:** Area/City`), then
   **Directives** — standing orders for *this* human only (canonical
   `user_google_email`). Not a second copy of Voice / Do; every rule
   restated there is one more line the closer has to fight for attention.
6. One load-bearing closer at the **end** (recency): review `[mcp prefixes]`
   on vs off; `mcp_enable` then call if off; if a tool is in this turn’s
   list, call it; **Prefer parallel tool calls**; independent lookups all in
   this response; don’t invent live facts; do the thing; a question of
   your own ends the turn and takes `[wait]`; with nothing left to do
   and no question of your own, you may end with “Anything else I can
   do or add for you?” and that closer takes no `[wait]`

Put the rule that must never slip on the last line. Models weight the last
instruction they saw. That closer is the **only** place a rule may appear
twice; the kernel-stamped Self-notes / Location pins / Follow-up sections
already restate `self_note` scope and GPS handling, so the text you write
should not.

**Cut:** product pitches, duplicate sections, per-server encyclopedias,
anything `/tools` already shows, **progress logs / mileage / open loops**
(those are memory, not persona). If a sentence does not change behavior,
delete it.

Canonical seed: `app/components/agents/personaTemplate.ts`.

### Settings seed

One copy. A new agent's `config.persona` starts as that template. On
the first open it is copied into the `PERSONA.md` row once, when the
table is empty and the text is non-blank. There is no second template
to keep in lockstep.

**Inject user** (admin) then patches **About you** from the signed-in
user's profile — name, email, timezone, location, languages, notes, chat
ids. **Identity** (the agent's name from the slug) stays. The inject
code lands with the settings screens ([todo.md](todo.md) §4). Do not
rename About you labels without updating that inject. Recreate never
overwrites an existing `PERSONA.md`.

When you change the seed, that file is the change.

---

## `SELF.md`

Agent-written, append-only mid-chat, merge on `/new`. You prune it.
The operator fold is `GET` / `PUT /api/agents/:slug/self` (an empty
body is refused).

Keep **3–5 north-star sentences** (how you show up for months). Move mileage,
dates, and open loops to memory (`aim/<area>`). Audit: [troubleshooting.md](troubleshooting.md#selfmd--personality-drift).
Why not all SQL / not all this file: [Where the horizon lives](#where-the-horizon-lives).

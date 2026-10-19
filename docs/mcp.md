# MCP host

How tools are named for the model, how a prefix is turned on, and how
the host recovers from a bad name.

On this product the plugins are in-process modules under
`harness/plugins`. There is no stdio transport and no child process.
`harness/tools` is the registry: `{plugin}__{tool}`, `mcp_enable`,
truncation, and the skip list. Builtins (memory, cron, watch,
`self_note`, aims) have no prefix and never idle-drop. The `websearch`
plugin publishes unprefixed `web_search` when granted (`bare: true`).
The shapes stay MCP-shaped so the Tools grid and eval fixtures do not
change. Pictures: [architecture.md](architecture.md). Pasteable live
checks for a person in chat: [live-check.md](live-check.md).

A plugin `ready()` returns `null` or a skip: `no_key`, `no_oauth`,
`disabled`, `error`. That list is the `status` frame. `GARMIN_TOOL_TIER`
and `GOOGLE_TOOL_PRESET` narrow those two catalogs before publish.
Grants from the Tools fold reach the registry directly.

Long-horizon planning uses tools over days (cron, watches). The host has to
repair names and finish turns or the horizon collapses into ERROR.

---

## Why MCP (and nothing else)

| Goal | How MCP helps |
| --- | --- |
| Keep the loop small | Calendar and mail stay in the `google` plugin. Web search is the `websearch` plugin. |
| Clear grant model | A plugin on the Tools fold is granted. Omit it and it is not in the catalog. `ready()` still skips a granted plugin with no key or no token |
| One bundle | The plugins ship in the Worker |
| Swappable brains | Same tool schemas work for Gemini, ChatGPT, Ollama — OpenAI-compat tool calls |

Chat, memory, and cron work with **zero** MCP servers. Web search needs
the `websearch` grant and a search key. Other tools are optional.

---

## Naming: `{server}__{tool}`

**Authoring new MCP tools?** Follow the shared package contract:
[mcp-naming.md](mcp-naming.md) (`{service}_{verb}_{object}`, no server-id in the
tool name, stable verbs, sibling nouns). This section is the **host** side.

Every published tool reaches the model as:

```text
{server_or_tools_prefix}__{original_tool_name}
```

Examples:

| Manifest `name` | MCP tool | Name the model must call |
| --- | --- | --- |
| `websearch` | `web_search` | `web_search` (unprefixed when granted) |
| `google` | `calendar_list_events` | `google__calendar_list_events` |
| `math` | `expression_evaluate` | `math__expression_evaluate` |
| `garmin` | `sleep_get` | `garmin__sleep_get` |
| `strava` | `activities_list`, `urls_resolve` | `strava__activities_list` |
| `feeds` | `items_list` | `feeds__items_list` |
| `twitter` | `posts_list` | `twitter__posts_list` |
| `maps` | `place_search`, `route_eta` | `maps__place_search` |
| `atlassian` | `jira_list_boards`, `confluence_list_spaces`, `confluence_search_pages` | `atlassian__jira_list_boards` |
| `cars` | `listings_search`, `vin_get` | `cars__listings_search` |
| `image` | `photo_generate`, `photo_edit` | `image__photo_generate` |
| `chat` | `avatar_update`, `theme_list` | `chat__avatar_update` |

MCP image bytes are not stuffed into the model prompt. The host
truncates tool results. The JSON summary stays, and chat puts
`images: [{ url }]` on the room reply (same shape as inbound). Grant
prefix `image`. Image bytes that another tool must read go to the Agent DO
sqlite table `image_output` under the `IMAGE_OUTPUT_DIR` directory string
(the native harness fills `/images` when that var is blank); chat
`avatar_update` / `backdrop_update` take
`source_path`.

**Why the prefix?** OpenAI-safe characters, no collisions across plugins, and
obvious provenance in logs and collapsed history markers. The prefix is
the plugin name (`harness/tools/names.ts`).

`/tools` and `/status` show `schema_est_tokens`. A plugin that cannot
serve is skipped (`no_key`, `no_oauth`, `disabled`, `error`) and the
agent continues. Calling a skipped prefix returns
`tool error [<reason>]: … is skipped — do not invent <name>__* names`.
The `status` frame: [contract.md](contract.md).

Plugins are modules under `harness/plugins/<name>/`
([custom-mcp.md](custom-mcp.md)). The `chat` plugin is the face,
wallpaper, and mood. [mcp-naming.md](mcp-naming.md) still lists that
row as `pendant` until Phase 4.

---

## Local models and hyphenated prefixes

Server names can use hyphens. Tool *suffixes* use underscores. Small local
models (e.g. Qwen via Ollama) frequently **normalize the whole name to
underscores** and invent nearby names.

Web search is the unprefixed builtin `web_search` (Brave Search HTTP —
titles, URLs, snippets). Leftover MCP names (`google-search__web_search`,
`google_search__web_search`) still call that builtin; they are not a second
model.

Typical hyphen-prefix failure spiral (why search is a builtin now):

1. Model calls `google-search__google_search` → unknown tool (invented suffix)
2. Host suggests a catalog name; model rewrites the prefix to underscores
3. Hint degrades to a bare prefix list → more guessing → think-stall

That is a **runtime** problem, not a persona typo. Exact names come from the
live catalog (tool schemas + `[mcp prefixes]` + `/tools`); the host also
hardens the call path.

### Alias resolve (automatic)

On `Call`, if the exact name is missing, the host rewrites **only the plugin
prefix** so underscores become hyphens, then retries lookup:

```text
google_search__web_search  →  builtin web_search   ✅ called
```

Tool suffixes are **not** rewritten (`calendar_list_events` stays
`calendar_list_events`). Search aliases are handled by the builtin, not by
prefix rewrite.

A real tool name wearing an invented or missing prefix is repaired the same way,
because a bounced call costs a full model round-trip — the most expensive thing
in a local-model turn:

```text
mcp__hrv_get  →  garmin__hrv_get   ✅ called
hrv_get       →  garmin__hrv_get   ✅ called
```

Two cases are left to the model on purpose:

- **Real prefix, wrong tool** (`garmin__athlete_get` when only Strava has it).
  The model chose that server deliberately, so it gets that server's catalog
  rather than a silent hop to a different server.
- **Two servers publish the name** (`activities_get` on both Garmin and Strava).
  Guessing is a coin flip, so both real names go back as a hint.

When any repair fires, logs show:

```text
mcp tool name aliased  requested=…  resolved=…
```

### Unknown-tool suggestions

If lookup still fails, the error string is model-facing and catalog-aware:

| Mistake | Hint shape |
| --- | --- |
| Wrong tool, real prefix | `valid garmin tools are: garmin__hrv_get — retry with one of these exact names` |
| Underscored prefix, wrong tool | `did you mean "garmin"?` + that server’s exact tool list |
| Invented name (fake prefix, merged suffix) | `closest real names are: garmin__wellness_get_body_battery, garmin__hrv_get — retry with one of these exact names` |
| Unknown prefix, nothing close | `available server prefixes are: garmin, google, maps, …` |

The agent loop feeds that error back as a tool result so the next iteration
can self-correct (same pattern as argument/schema failures).

Closest-name ranking scores shared name tokens, ignoring generic verbs (`get`,
`list`, `set`, …) that would otherwise match everything. A model that invents a
tool tends to stitch real fragments together — `mcp__get_hrv_and_body_battery`
is `get_hrv` plus `get_body_battery` under a prefix that does not exist — so the
fragments identify what it was reaching for even when neither prefix nor suffix
is real.

### Printed tool calls

A model can also skip the `tool_calls` field entirely and *print* the call:

```json
{ "name": "garmin__get_daily_activity", "parameters": { "date": "2026-07-28" } }
```

Without handling, that JSON is just assistant text, so it becomes the visible
reply — the agent answering in wire format. The host parses it back into a real
call and runs it, accepting the object bare, fenced, inside `<tool_call>` tags,
or embedded in prose, with arguments under `arguments`, `parameters`, `args`, or
`input` (models pick all of them).

```text
model printed a tool call instead of emitting one; executing it  name=… chars=90
```

The name must look like a tool — published, or at least carrying a `server__`
prefix — so an ordinary reply that happens to contain JSON is never hijacked. An
unpublished but prefixed name is still run on purpose: the host's answer is what
names the real tools, which feeds the retry below.

### Grammar-constrained retry

A hint only works if the model reads it. When a name cannot be resolved *and*
there are real candidates, the next model call is constrained instead: the host
sends `response_format` with a JSON schema whose `name` is an `enum` of those
candidates. Ollama compiles that to a GBNF grammar and masks every token that
would spell anything else, so a bad name stops being unlikely and becomes
impossible.

```text
tool call failed        name=mcp__get_hrv_and_body_battery
constraining retry …    requested=mcp__get_hrv_and_body_battery candidates=2
model call              iteration=2 forced_tool_names=2
```

Three details make it work:

- **`tools` stays in the request.** The model reads real parameter schemas from
  there. Drop it and the name is still legal but the arguments are invented
  (measured on Qwen: `start_date`/`end_date` instead of `date`).
- **The call arrives in `content`, not `tool_calls`.** Ollama omits `tool_calls`
  whenever a `response_format` is set (still true in 0.32.4), so the provider
  parses the JSON object back into a `ToolCall`.
- **It is one-shot, and never streams.** A grammar forces *every* reply to be
  JSON, so leaving it on would make conversational answers impossible; and
  streaming it would type raw JSON into the user's bubble.

No candidates means no constraint — forcing a call out of the whole catalog is
just a different guess.

### What aliasing does *not* fix

- Invented tool suffixes (`…__google_search`) — no real name to repair to, so these
  still need a retry with the suggested name (or a smaller published tool surface)
- Wrong arguments (e.g. passing a time range as `event_id`) — MCP/API errors
- Think-only turns with no tool call — agent nudge / stall path in
  `harness/agent`
- A model that neither calls nor prints anything callable — still a nudge, then
  the turn answers with whatever prose it has

---


## Grants and filters

The Tools fold grants are what the registry publishes. A plugin left
off the list is not in the catalog. `ready()` still skips a granted
plugin that has no key or no token: `no_key`, `no_oauth`, `disabled`,
`error`. `GARMIN_TOOL_TIER` and `GOOGLE_TOOL_PRESET` narrow those two
catalogs before publish.

### Keys

Required keys are what `ready()` treats as `no_key`. Optional keys
have a default. Feeds publish with no key; `FEEDS_USER_AGENT` only
overrides the User-Agent, which defaults to
`gantree/<version> (+https://gantree.bldhosting.com)`. The same list
is what the Keys fold suggests. A house key may come from the Worker
instead of the agent.

Garmin has no redirect login. Set `GARMIN_EMAIL` and `GARMIN_PASSWORD`,
then type `/auth garmin` in chat. When MFA is required, paste the code
as `/auth garmin <code>`.

| Plugin | Key | Required |
| --- | --- | --- |
| house | `LLM_BASE_URL` | yes, house or agent |
| house | `LLM_API_KEY` | yes, house or agent |
| house | `LLM_MODEL` | yes, house or agent |
| feeds | `FEEDS_USER_AGENT` | no |
| websearch | `SEARCH_API_KEY` | yes |
| websearch | `SEARCH_PROVIDER` | no — blank means brave |
| twitter | `X_BEARER_TOKEN` | yes |
| strava | `STRAVA_CLIENT_ID` | yes |
| strava | `STRAVA_CLIENT_SECRET` | yes |
| maps | `GOOGLE_MAPS_API_KEY` | yes |
| flights | `SERPAPI_API_KEY` | yes |
| rentals | `RENTCAST_API_KEY` | yes |
| google-health | `GOOGLE_HEALTH_CLIENT_ID` | yes |
| google-health | `GOOGLE_HEALTH_CLIENT_SECRET` | yes |
| google | `GOOGLE_OAUTH_CLIENT_ID` | yes |
| google | `GOOGLE_OAUTH_CLIENT_SECRET` | yes |
| google | `GOOGLE_TOOL_PRESET` | no — `everyday` (default), `lean`, or `all` |
| garmin | `GARMIN_EMAIL` | yes |
| garmin | `GARMIN_PASSWORD` | yes |
| garmin | `GARMIN_TOOL_TIER` | no — `core` (default), `extended`, or `complete` |
| atlassian | `ATLASSIAN_SITE` | yes |
| atlassian | `ATLASSIAN_EMAIL` | yes |
| atlassian | `ATLASSIAN_API_TOKEN` | yes |
| cars | `MARKETCHECK_API_KEY` | yes |
| cars | `MARKETCHECK_BASE_URL` | no |

The Worker house env may also supply `SEARCH_API_KEY` and
`SEARCH_PROVIDER` (`HOUSE_KEYS`); the Keys fold documents them under
`websearch` only.

### Prefix enable

By default MCP schemas stay **off** until the agent calls `mcp_enable`
(list of prefixes, next model call in the same turn). The prompt lists
on vs off under `[mcp prefixes]` and tells the model to enable a needed
off prefix this turn. A brief hold idles out at 6h; a short hold at 27h.
Builtins (memory, cron, watch, `self_note`, `web_search`, aims) stay on
and never idle-drop.

`DYNAMIC_TOOLS=false` publishes the full catalog every turn and turns
`mcp_enable` off. `MCP_ENABLE_FORCE` is a comma-separated list of
prefixes that stay on while dynamic tools are on
(`google__calendar,garmin__sleep`). `/brief`, `/short`, and `/off` are
the human overrides. `/tools` shows published vs available.

The X plugin keeps its own monthly read budget. A watch on a metered
plugin should set an interval the plan can afford (a 15-minute poll is
96 calls a day).

## Checklist

- [ ] Grant only the plugins this persona should have. Leave a key unset and a granted plugin skips
- [ ] Prefer `GARMIN_TOOL_TIER` / `GOOGLE_TOOL_PRESET` so the model sees tens of tools, not hundreds
- [ ] After deploy, `/tools` once and confirm the published names
- [ ] On weird tool loops: check logs for `aliased` vs repeated `unknown tool`

---

## Related

- [architecture.md](architecture.md) — the harness
- [custom-mcp.md](custom-mcp.md) — adding a plugin module
- [persona.md](persona.md) — `PERSONA.md` is not the tool catalog
- [cron.md](cron.md#event-watches) — poller + `feeds` / `twitter`
- [mcp-naming.md](mcp-naming.md) — package-author naming contract
- [contract.md](contract.md) — the `status` frame settings reads

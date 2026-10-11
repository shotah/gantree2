# MCP tool naming

Canonical contract for every plugin. Modules live under
`brain/plugins/<name>/` and `brain/tools/names.ts` prefixes
`{plugin}__{tool}`. This page is what goes on the right of the
`__`. Plugins do not get a local dialect.

Tools take a set and return a list. The rule is
`.cursor/rules/brain-plugins-plural.mdc`. A tool that is one thing
sets `single` and says why.

**Why it matters:** small models and the host's closest-match repair
pick tools by **name tokens + description**. Synonyms and double
prefixes break matching, and a broken match is a serial round the Go
loop could have batched.

Related: how a plugin is added ([custom-mcp.md](custom-mcp.md));
the eval that fails a fixture when a plugin renames a tool
([eval_setup.md](eval_setup.md#real-catalogs-tools_from)).

---

## Layers (do not confuse them)

| Layer | Who owns it | Example |
| --- | --- | --- |
| Plugin id | directory name under `brain/plugins/` | `strava`, `google`, `garmin` |
| Tool name | what the plugin registers | `activities_list`, `calendar_list_events` |
| **Host-facing name** | `{plugin}__{tool}` | `strava__activities_list` |

```text
{server_id}__{service}_{verb}_{object}[_{qualifier}]
```

---

## Hard rules

1. **Tool = `{service}_{verb}_{object…}`**
   Service first (resource / domain), then verb, then object. Same
   family as google-mcp (`calendar_list_events`, `gmail_search_messages`).

2. **Never put the plugin id in the tool name**
   The host already prefixes.
   - Bad: `garmin_sleep_get` → `garmin__garmin_sleep_get`
   - Bad: `strava_get_activities` → `strava__strava_get_activities`
   - Good: `activities_list` → `strava__activities_list`

3. **No dual aliases**
   One name set per release. A breaking rename is a semver bump on the
   plugin, and the eval fixtures updated **in the same PR**.
   `npm run eval` fails catalog drift before any model call.

4. **Stable verb set** (prefer these; don't invent synonyms)

   | Verb | Meaning |
   | --- | --- |
   | `list` | Collection / page / day window |
   | `get` | One resource by id |
   | `search` | Query → hits |
   | `create` / `update` / `delete` | Mutations |
   | `format` | Pure reshape / hint (no side effects) |

   Avoid verb-first tools (`search_tracks`, `get_sleep`) — rename to
   `tracks_search` / `sleep_get` style when touching that surface.

5. **Shared nouns across plugins** when the concept is shared

   | Concept | Preferred service token | Used by |
   | --- | --- | --- |
   | Calendar events | `calendar_` | google |
   | Activities / workouts | `activities_` | garmin, strava |
   | Saved Strava courses / share links | `routes_` / `urls_` | strava (`urls_resolve`; not `maps__link_resolve`) |
   | Devices (hardware) | `devices_` | garmin |
   | Math | `expression_` / `units_` | math |
   | Web search | `web_` | builtin `web_search` (not a plugin) |
   | Flight offers / dates / airports / returns / booking / quota | `offers_` / `dates_` / `airports_` / `returns_` / `booking_` / `link_` / `account_` | flights |
   | Rental listings / rent estimate / markets / areas / quota | `listings_` / `rent_` / `markets_` / `areas_` / `link_` / `account_` | rentals |
   | Car listings / VIN / markets / quota | `listings_` / `vin_` / `markets_` / `link_` / `account_` | cars (prefix disambiguates from rentals) |
   | Feed items / feed URL discovery | `items_` / `source_` | feeds |
   | X / Twitter public posts | `posts_` | twitter (not `tweets_`) |
   | Places / Maps share links / leave-by | `place_` / `link_` / `route_` | maps (`place_search`; `link_resolve` not `short_url_*`; `route_eta` is leave-by) |
   | Generated / edited pictures | `photo_` | image (`photo_generate` / `photo_edit`; not `image_*` — double prefix) |
   | Chat face / wallpaper / room mood | `avatar_` / `backdrop_` / `theme_` | chat (`avatar_update`, `backdrop_update`, `theme_list`; not `chat_*`, not `pendant_*`) |

6. **Descriptions sell the intent**
   First sentence = what the agent wants ("List recent Strava
   activities…", "Get last night's sleep…"). Nearest-name matching uses
   these tokens. Do not start with "Calls the Strava API v3
   athlete/activities…"

7. **Args: snake_case**
   `task_list_id`, `video_id`, `time_min` — never camelCase in schemas.
   Teach-in errors > silent defaults.

8. **Don't steal another plugin's domain words**
   No `calendar_*` on fitness plugins for Google Calendar asks. No
   `mail_*` on Strava. A "calendar" of workouts is `training_calendar_*`
   (or excluded from the core tier).

9. **Lean catalogs**
   Prefer `GARMIN_TOOL_TIER` and `GOOGLE_TOOL_PRESET` so the published
   set stays small. Fat schemas starve local models even when names are
   perfect.

10. **Tests lock names**
    Every plugin asserts each registered tool matches `^[a-z]+_[a-z]+`
    and does **not** start with the plugin id string. That test lives
    under `test/brain/plugins/`.

---

## Host forms

| Server id | Example tools | Host-facing name |
| --- | --- | --- |
| `google` | `calendar_list_events` | `google__calendar_list_events` |
| `garmin` | `sleep_get`, `activities_list` | `garmin__sleep_get` |
| `strava` | `activities_list`, `routes_list`, `urls_resolve` | `strava__activities_list` |
| `math` | `expression_evaluate`, `units_convert` | `math__expression_evaluate` |
| `flights` | `offers_search`, `dates_search`, `airports_search`, `returns_search`, `booking_options_get`, `link_format`, `account_get` | `flights__offers_search` |
| `rentals` | `listings_search`, `listings_get`, `rent_estimate_get`, `markets_get`, `areas_resolve`, `link_format`, `account_get` | `rentals__listings_search` |
| `cars` | `listings_search`, `listings_get`, `vin_get`, `markets_get`, `link_format`, `account_get` | `cars__listings_search` |
| `feeds` | `items_list`, `source_resolve` | `feeds__items_list` |
| `twitter` | `posts_list` | `twitter__posts_list` |
| `maps` | `link_resolve`, `place_resolve`, `place_search`, `route_eta` | `maps__place_search` |
| `image` | `photo_generate`, `photo_edit` | `image__photo_generate` |
| `chat` | `avatar_update`, `backdrop_update`, `theme_list` | `chat__avatar_update` |

Hyphenated plugin ids are fine; tool suffixes stay underscores. The
host aliases underscored prefixes (`google_health__…` →
`google-health__…`) on call — **suffixes are never rewritten**. Web
search is the unprefixed builtin `web_search`.

---

## Checklist for a new or reshaped plugin

- [ ] Pick a **short** server id (`strava`, not `go-strava-mcp`)
- [ ] Every tool is `{service}_{verb}_{object…}` with no server-id prefix
- [ ] Diff verbs/nouns against the table above before inventing a third synonym
- [ ] Descriptions lead with agent intent
- [ ] Args snake_case; hot paths documented in the tool description
- [ ] Name assertion test; no dual registration
- [ ] `host-manifest` prints; `mcp.lock` row added or bumped
- [ ] Eval fixtures that name the tool updated in the same PR
- [ ] Release notes include old→new map; bump semver on break

---

## Anti-patterns (seen in the wild)

| Anti-pattern | Why it hurts | Fix |
| --- | --- | --- |
| `strava_*` tools on server `strava` | Double prefix | Drop tool-level brand |
| `tracks_*` vs `videos_*` mixed | Nearest-match thrash | One noun per product era |
| `search_tracks` (verb-first) | Breaks `{service}_{verb}_…` scanners | `videos_search` |
| `get_daily_schedule` as a memory "skill" name | Not a host tool name | Skills cite real `google__calendar_list_events` |
| Publishing `calendar_get` on Garmin | Steals Google Calendar | Rename or `exclude` |
| Catalog pasted into `PERSONA.md` | Stale the day a plugin ships | Recipes live in tool descriptions and the live catalog |

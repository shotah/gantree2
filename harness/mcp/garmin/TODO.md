# TODO — MCP tool rename (`{service}_{verb}_{object}`)

**Status:** done (2026-07-29)  
**Why:** Hosts expose `{server}__{tool}` (ai-gantry server id = `garmin`). Bare
`list_activities` / `get_sleep` collide mentally with Strava/Google and starve
small models. Align with [google-mcp](https://github.com/shotah/google-mcp):
**service first**, then verb + object.

**Rule:** Do **not** prefix tools with `garmin_` — the server id already supplies
that. Host forms look like `garmin__activities_list`, `garmin__sleep_get`.

**Consumer:** [ai-gantry](https://github.com/shotah/ai-gantry) persona `TOOLS.md`
+ master plan in repo `todo.md` (Gemini train → cut back to Qwen).

---

## Convention

```text
{service}_{verb}_{object}[_{qualifier}]
```

Services (match endpoint packages / tool prefix): `activities`, `sleep`,
`wellness`, `weight`, `hrv`, `metrics`, `workouts`, `devices`, `profile`,
`utility`, `summary`, …

Source of truth: `MCPTool` in `endpoint/definitions/*.go` and tier maps in
`endpoint/mcp_filter.go`.

---

## Core tier (gantry `--tool-tier core`)

| Old | New | Host after |
| --- | --- | --- |
| `get_current_date` | `utility_get_current_date` | `garmin__utility_get_current_date` |
| `get_sleep` | `sleep_get` | `garmin__sleep_get` |
| `get_weight` | `weight_get` | `garmin__weight_get` |
| `get_body_battery` | `wellness_get_body_battery` | `garmin__wellness_get_body_battery` |
| `get_hrv` | `hrv_get` | `garmin__hrv_get` |
| `get_training_readiness` | `metrics_get_training_readiness` | `garmin__metrics_get_training_readiness` |
| `list_activities` | `activities_list` | `garmin__activities_list` |
| `get_activity` | `activities_get` | `garmin__activities_get` |
| `get_activity_typed_splits` | `activities_get_typed_splits` | `garmin__activities_get_typed_splits` |
| `get_activity_split_summaries` | `activities_get_split_summaries` | `garmin__activities_get_split_summaries` |

Checklist:

- [x] Rename `MCPTool` strings in `endpoint/definitions/*.go`
- [x] Update `endpoint/mcp_filter.go` tier lists
- [x] Update README / MCP docs examples
- [x] Tests that assert tool names
- [x] Cut release; ai-gantry persona + any hardcoding (`v0.2.0` on host)

---

## Extended + complete

Same rule applied to every `MCPTool` (no dual aliases).

Examples:

| Old | New |
| --- | --- |
| `get_stress` | `wellness_get_stress` |
| `get_heart_rate` | `wellness_get_heart_rate` |
| `get_activity_details` | `activities_get_details` |
| `list_workouts` | `workouts_list` |
| `get_workout` | `workouts_get` |
| `get_vo2max` | `metrics_get_vo_two_max` |
| `get_daily_user_summary` | `summary_get_daily` |

- [x] Full pass over `endpoint/definitions/`
- [x] No dual aliases (one name set per release — same as google-mcp)
- [x] Release notes with old→new table (when cutting the release)

---

## Out of scope / follow-ups

- Changing OAuth / session paths
- Growing the core tier count for Tim (keep ~10)

## Agent-clarity: rename Connect “calendar” (steals Google Calendar)

`training_calendar_get` is the Connect training calendar. Menstrual
`periodic_health_get_menstrual_calendar` still contains a `calendar` token
later in the name; the naming lock only rejects a `calendar_` prefix.

- [x] Rename `calendar_get` → `training_calendar_get`
- [ ] Rename `periodic_health_get_menstrual_calendar` → drop the bare `calendar`
      token (e.g. `periodic_health_get_menstrual_cycle`)
- [x] Soften Short/Long blurbs — never “what's on my calendar” (that’s Google)

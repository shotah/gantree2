# Agent guide — google-health-mcp

Host server id: **`ghealth`** → `ghealth__{tool}`.
Do **not** prefix tools with `ghealth_` / `health_` / `google_` inside the binary.

## Recipes (same as garmin, different host)

```text
Last night’s sleep
  → ghealth__sleep_get   (omit dates; wake-up day is today)

Sleep / resting HR / HRV over a span (one call each, not one per day)
  → ghealth__sleep_get        after_date + before_date → sessions[]
  → ghealth__heart_rate_get   after_date + before_date → entries[]
  → ghealth__hrv_get          after_date + before_date → entries[]
  after_date inclusive, before_date exclusive, human timezone

Recovery (last night)
  → ghealth__sleep_get
  → ghealth__heart_rate_get
  → ghealth__hrv_get

What did I do yesterday?
  → ghealth__activities_list  (after_date / before_date in human TZ)
  → ghealth__activities_get   (when they pick one)

Weight trend
  → ghealth__weight_get       (period already returns entries[])
```

## Hard rules

- Google Health cloud data only — not Garmin, not Strava, not Google Calendar.
- Friends on Fitbit / Pixel Watch → `ghealth__…` (not “Google Fit” REST).
- Do not invent the Google Health app Sleep Score (0–100). It is not in the API.
  Report `efficiency`, `stages_minutes`, and the minute fields on `sessions[]`.
- Do not invent readiness or workouts.
- Auth fail → tell human to run `google-health-mcp auth` / `gantry auth ghealth`.

## Routing

| Ask | Use | Avoid |
| --- | --- | --- |
| Sleep / recovery (Fitbit friends) | `ghealth__…` | `garmin__` unless they own a Garmin |
| Workouts (wearable) | `ghealth__activities_*` | inventing “no activity tool” |
| Calendar | `google__calendar_*` | anything here |

## TOOLS.md snippet (when wired)

```markdown
## Google Health / Fitbit friends
- **Google Health MCP (`google-health-mcp`, server id `ghealth`)** — sleep, HR/HRV, exercises, weight
- **Exact tools:** `ghealth__sleep_get`, `ghealth__activities_list`, `ghealth__activities_get`, `ghealth__heart_rate_get`, `ghealth__hrv_get`, `ghealth__weight_get`, `ghealth__profile_get`, `ghealth__account_get`
- Last night’s sleep: `ghealth__sleep_get` (omit dates). A span: one call with `after_date` / `before_date`, read `sessions[]`. Same for `heart_rate_get` and `hrv_get` (`entries[]`).
- App Sleep Score (0–100) is not in the API. Use `efficiency` and `stages_minutes`.
- “What did I do?” → `ghealth__activities_list` first (timezone from `[current time]`)
- Needs Google OAuth tokens (`gantry auth ghealth` / `google-health-mcp auth`)
```

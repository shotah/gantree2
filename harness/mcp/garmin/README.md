<p align="center">
  <img src="assets/banner.svg" alt="go-garmin" width="100%">
</p>

# go-garmin

A Go client library, CLI, and MCP server for the Garmin Connect API.

Use it as:

- a **Go library** in your own programs
- a **CLI** (`garmin …`) that prints JSON
- an **MCP server** (`garmin mcp`) so LLM assistants can query and update your Garmin data

## Features

- OAuth login with MFA support and automatic token refresh
- Declarative endpoint registry: one definition drives CLI commands + MCP tools
- Broad Connect coverage: sleep, wellness, activities, training metrics, workouts, summary stats, badges, blood pressure, lifestyle, and more
- VCR-backed integration fixtures for reliable tests

## Installation

### Prerequisites

- Go 1.25 or later ([install Go](https://go.dev/doc/install))
- `$GOPATH/bin` (usually `~/go/bin`) on your `PATH`

### Install CLI

```bash
go install github.com/shotah/go-garmin/cmd/garmin@latest
garmin --version
```

### Build from source

```bash
git clone https://github.com/shotah/go-garmin.git
cd go-garmin
go build -o bin/garmin ./cmd/garmin
./bin/garmin --help
```

## Quick start

```bash
# 1. Interactive login (email / password / MFA) → saves session.json
garmin login

# Chat / headless MFA (creds from env — never paste passwords in chat):
#   export GARMIN_EMAIL=… GARMIN_PASSWORD=…
#   garmin login url
#   garmin login exchange <mfa-code>

# 2. Smoke test
garmin sleep
garmin metrics readiness

# 3. Optional: expose the same session to an LLM via MCP
garmin mcp
```

Session file location:

| OS | Path |
|----|------|
| Linux / macOS | `~/.config/garmin/session.json` (or `$XDG_CONFIG_HOME/garmin/session.json`) |
| Windows | `%AppData%\garmin\session.json` |
| Gantry / Docker | `$DATA_DIR/.config/garmin/session.json` when `DATA_DIR` is set (survives recreate) |

Access tokens refresh automatically on API calls. Rotated tokens are written back to `session.json`. If the refresh token itself is revoked, run `garmin logout` then `garmin login` again.

## CLI usage

All commands print JSON (suitable for `jq`, scripts, and piping).

### Authentication

```bash
garmin login     # interactive email / password / MFA
garmin logout    # delete saved session
```

### Commands

```bash
# Sleep
garmin sleep [date]

# Wellness
garmin wellness stress [date]
garmin wellness body-battery [date]
garmin wellness heart-rate [date]
garmin wellness spo2 [date]
garmin wellness respiration [date]
garmin wellness intensity-minutes [date]
garmin wellness events [date]
garmin wellness sleep [date] [--display-name=...]
garmin wellness steps [date] [--display-name=...]
garmin wellness floors [date]
garmin wellness body-battery-reports [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
garmin wellness sleep-score [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]

# Daily totals (user summary)
garmin summary daily [date] [--display-name=...]
garmin summary hydration [date]
garmin summary log-hydration --json='{"calendarDate":"2026-07-15","timestampLocal":"2026-07-15T12:00:00.000","valueInML":250}'
garmin summary steps-daily [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
garmin summary steps-weekly [end] [--weeks=4]
garmin summary stress-daily [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
garmin summary stress-weekly [end] [--weeks=4]
garmin summary hydration-stats [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
garmin summary im-daily [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
garmin summary im-weekly [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]

# Activities
garmin activities list [--start=0] [--limit=20]
garmin activities get <activity-id>
garmin activities types
garmin activities splits <activity-id>
garmin activities weather <activity-id>
garmin activities details <activity-id>
garmin activities hr-zones <activity-id>
garmin activities power-zones <activity-id>
garmin activities exercise-sets <activity-id>

# Weight and HRV
garmin weight daily [date]
garmin weight range --start=YYYY-MM-DD --end=YYYY-MM-DD
garmin hrv daily [date]
garmin hrv range --start=YYYY-MM-DD --end=YYYY-MM-DD

# Training metrics
garmin metrics readiness [date]
garmin metrics vo2max [date]
garmin metrics endurance [date]
garmin metrics hill [date]
garmin metrics hill-stats --start=YYYY-MM-DD --end=YYYY-MM-DD
garmin metrics training-status [date]
garmin metrics load-balance [date]
garmin metrics acclimation [date]
garmin metrics race-predictions [display-name]
garmin metrics race-predictions-daily [date]
garmin metrics race-predictions-monthly [date]

# Fitness age / fitness stats
garmin fitnessage daily [date]
garmin fitnessage stats --start=YYYY-MM-DD --end=YYYY-MM-DD
garmin fitnessstats get [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--aggregation=weekly] [--metrics=calories,distance,duration]
garmin fitnessstats activities [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--activity_type=running] [--metrics=name,startLocal,activityType]

# Biometrics / devices / profile
garmin biometric lactate-threshold
garmin biometric ftp
garmin biometric hr-zones
garmin biometric power-weight [date]
garmin devices list
garmin devices settings <device-id>
garmin profile social
garmin profile settings
garmin profile display

# Workouts
garmin workouts list [--start=0] [--limit=20]
garmin workouts get <workout-id>
garmin workouts create --file=workout.json
garmin workouts create --json='{"workoutName": "..."}'
cat workout.json | garmin workouts create
garmin workouts update <workout-id> --file=workout.json
garmin workouts delete <workout-id>
garmin workouts schedule <workout-id> <date>
garmin workouts unschedule <schedule-id>

# Exercise library (strength workouts)
garmin exercises categories
garmin exercises muscles
garmin exercises equipment
garmin exercises list [--category=BENCH_PRESS] [--muscle=CHEST] [--equipment=DUMBBELL]
garmin exercises get <exercise-key>

# Calendar (month is 0-indexed: January=0)
garmin calendar get --year=2026 [--month=0] [--day=28] [--start=1]

# Personal records / training plans
garmin records list
garmin plans list
garmin plans phased <plan-id>
garmin plans adaptive <plan-id>

# Badges and challenges
garmin badges earned
garmin badges available
garmin badges challenges-completed
garmin badges challenges-available
garmin badges challenges-open
garmin badges virtual
garmin badges adhoc

# Blood pressure
garmin bp range --start=YYYY-MM-DD --end=YYYY-MM-DD
garmin bp log --json='{"systolic":120,"diastolic":80,...}'
garmin bp delete --date=YYYY-MM-DD --version=1

# Periodic health
garmin health day [date]
garmin health calendar --start=YYYY-MM-DD --end=YYYY-MM-DD
garmin health pregnancy

# Lifestyle logging
garmin lifestyle daily [date]
garmin lifestyle create-behaviour --json='{"name":"Went drinking",...}'

# Golf scorecards
garmin golf list [--start=0] [--limit=20]
garmin golf get <scorecard-id>
garmin golf shots <scorecard-id> [--holes=1,2,3,...]
```

## MCP server (LLM integration)

`garmin mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. Hosts like Claude Code, Claude Desktop, and Cursor spawn that process and let the model call tools.

### Tool naming

MCP tool names use `{service}_{verb}_{object}` (e.g. `sleep_get`,
`activities_list`, `wellness_get_body_battery`). Do **not** prefix with
`garmin_` — hosts already add the server id (`garmin__sleep_get`).

### Narrowing the tool surface

By default every eligible endpoint is published (~100 tools). That is often too
large for small chat models. Filter at registration:

| Flag | Meaning | Default |
|------|---------|---------|
| `--tools` | Space/comma-separated **services** (`sleep`, `wellness`, `hrv`, `weight`, `activities`, `metrics`, …) | all |
| `--tool-tier` | Depth within those services: `core` \| `extended` \| `complete` | `complete` |

```bash
# ~10 recovery / coaching tools (sleep, weight, BB, HRV, readiness, activities + climbing splits)
garmin mcp --tool-tier core

# Same, but only from selected services
garmin mcp --tools "sleep wellness hrv weight activities metrics utility" --tool-tier core
```

**`core`:** `utility_get_current_date`, `sleep_get`, `weight_get`, `wellness_get_body_battery`,
`hrv_get`, `metrics_get_training_readiness`, `activities_list`, `activities_get`,
`activities_get_typed_splits`, `activities_get_split_summaries`.

**`extended`:** core plus `wellness_get_stress`, `wellness_get_heart_rate`,
`wellness_get_body_battery_reports`, `wellness_get_sleep_score_stats`, `wellness_get_intensity_minutes`,
`metrics_get_training_status`, `metrics_get_vo2max`, `activities_get_details`,
`summary_get_daily`.

**`complete`:** all tools in the selected services (historical behavior).

Unknown `--tools` service names fail boot. Published count is logged on stderr.

### What the AI actually reads

The model does **not** automatically read this README, `ENDPOINTS.md`, or the Go source.

When the MCP host connects, it asks the server for its tool list. For each registered endpoint, go-garmin exposes:

| What the model sees | Where it comes from |
|---------------------|---------------------|
| **Tool name** | `MCPTool` in `endpoint/definitions/*.go` (e.g. `sleep_get`) |
| **Tool description** | the endpoint `Long` string |
| **Argument schema** | each `Param` name/type/required + `Description` |
| **JSON body hints** (write tools) | `BodyConfig.Description` and `BodyConfig.Example` |
| **Tool results** | pretty-printed JSON returned by the Garmin API handler |

Flow:

1. Host starts `garmin mcp` (optionally with `--tool-tier` / `--tools`) and loads `session.json`.
2. Host sends `tools/list` → model gets names + descriptions + schemas (filtered set, or ~100 by default).
3. Model picks a tool and arguments (e.g. `sleep_get` with `date=2026-07-14`).
4. Host sends `tools/call` → handler hits Garmin Connect → result comes back as JSON text.
5. Model reasons over that JSON to answer you.

Useful implications:

- Prefer `--tool-tier core` (or `extended`) for personal-assistant hosts so the model is not flooded.
- Better `Long` / param descriptions in endpoint definitions = better tool use.
- `utility_get_current_date` is a local helper (no Garmin call) so the model can resolve “today” / “yesterday”.
- Binary downloads (`RawOutput`) are CLI-only and are **not** registered as MCP tools.
- Auth is invisible to the model: it just gets errors if you are not logged in.

### Prerequisites

1. Install the CLI (see [Installation](#installation))
2. Login once: `garmin login`
3. Confirm: `garmin sleep` returns data

### Claude Code

Add to `~/.claude.json` (global) or `.claude/settings.json` (project):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "garmin",
      "args": ["mcp", "--tool-tier", "core"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "garmin",
      "args": ["mcp", "--tool-tier", "core"]
    }
  }
}
```

### Cursor

Add to Cursor MCP settings:

```json
{
  "garmin": {
    "command": "garmin",
    "args": ["mcp", "--tool-tier", "core"]
  }
}
```

### Troubleshooting

1. Verify PATH: `which garmin` / `where garmin`
2. Confirm login: `garmin sleep`
3. Use an absolute binary path in MCP config if the host cannot find `garmin`
4. Re-login after Garmin invalidates the refresh token: `garmin logout && garmin login`

### Example prompts

- "How did I sleep last night?"
- "What's my training readiness today?"
- "Show my personal records and hill score trend this week"
- "Log 250ml of water"
- "Create a custom lifestyle behaviour called Went drinking"
- "Create a 45-minute threshold interval workout and schedule it for tomorrow"

### Available tools

With `--tool-tier complete` (default), the MCP server exposes **100 tools**
generated from the endpoint registry:

| Category | Tools |
|----------|-------|
| Utility | `utility_get_current_date` |
| Sleep | `sleep_get` |
| Wellness | `wellness_get_stress`, `wellness_get_body_battery`, `wellness_get_heart_rate`, `wellness_get_spo2`, `wellness_get_respiration`, `wellness_get_intensity_minutes`, `wellness_get_daily_events`, `wellness_get_sleep`, `wellness_get_steps_chart`, `wellness_get_floors`, `wellness_get_body_battery_reports`, `wellness_get_sleep_score_stats` |
| User summary | `summary_get_daily`, `summary_get_hydration`, `summary_log_hydration`, `summary_get_steps_daily`, `summary_get_steps_weekly`, `summary_get_stress_daily`, `summary_get_stress_weekly`, `summary_get_hydration_stats`, `summary_get_intensity_minutes_daily`, `summary_get_intensity_minutes_weekly` |
| Activity | `activities_list`, `activities_get`, `activities_get_types`, `activities_get_splits`, `activities_get_weather`, `activities_get_details`, `activities_get_hr_zones`, `activities_get_power_zones`, `activities_get_exercise_sets`, `activities_get_typed_splits`, `activities_get_split_summaries`, `activities_get_gear` |
| Weight / HRV | `weight_get`, `hrv_get` |
| Metrics | `metrics_get_training_readiness`, `metrics_get_training_status`, `metrics_get_vo2max`, `metrics_get_endurance_score`, `metrics_get_hill_score`, `metrics_get_hill_score_stats`, `metrics_get_training_load_balance`, `metrics_get_heat_altitude_acclimation`, `metrics_get_race_predictions`, `metrics_get_race_predictions_daily`, `metrics_get_race_predictions_monthly` |
| Fitness age / stats | `fitness_age_get`, `fitness_age_get_stats`, `fitness_stats_get`, `fitness_stats_get_activities` |
| Biometric | `biometric_get_lactate_threshold`, `biometric_get_cycling_ftp`, `biometric_get_heart_rate_zones`, `biometric_get_power_to_weight` |
| Devices / profile | `devices_list`, `devices_get_settings`, `profile_get_social`, `profile_get_user_settings`, `profile_get_settings` |
| Workouts | `workouts_list`, `workouts_get`, `workouts_create`, `workouts_update`, `workouts_delete`, `workouts_schedule`, `workouts_unschedule` |
| Exercises | `exercises_list_categories`, `exercises_list_muscle_groups`, `exercises_list_equipment`, `exercises_list`, `exercises_get` |
| Calendar / courses | `calendar_get`, `courses_list`, `courses_get`, `courses_delete` |
| Records / plans | `personal_records_get`, `training_plans_list`, `training_plans_get_phased`, `training_plans_get_adaptive` |
| Badges | `badges_get_earned`, `badges_get_available`, `badges_get_completed_challenges`, `badges_get_available_challenges`, `badges_get_open_challenges`, `badges_get_virtual_in_progress`, `badges_get_adhoc_historical` |
| Blood pressure | `blood_pressure_get_range`, `blood_pressure_log`, `blood_pressure_delete` |
| Periodic health | `periodic_health_get_menstrual_day`, `periodic_health_get_menstrual_calendar`, `periodic_health_get_pregnancy` |
| Lifestyle | `lifestyle_get_daily`, `lifestyle_create_behaviour` |
| Golf | `golf_list_scorecards`, `golf_get_scorecard`, `golf_get_shot_data` |

### LLM-powered workout creation

Ask in natural language; the model uses the exercise library (~1,794 exercises) and workout tools to build Connect-compatible workouts.

**Running**

> "Create a 45-minute interval workout with 5-minute warmup, 6x3min at threshold with 2min recovery, and cooldown"

**Strength**

> "Create a push day: bench press 4x8, overhead press 3x10, tricep dips 3x12, 90s rest"

**Planning**

> "Look at my recent activities and create a recovery workout for tomorrow"

#### Workout sport types

| Sport | ID | Features |
|-------|----|----------|
| Running | 1 | Pace zones, HR zones, distance/time |
| Cycling | 2 | Power zones, cadence, distance/time |
| Swimming | 4 | Stroke types, equipment, pool length |
| Strength | 5 | Exercise library, reps, sets, rest |
| Cardio | 6 | HR zones, time targets |
| Yoga | 7 | Time-based flows |
| Pilates | 8 | Time-based sequences |
| HIIT | 9 | Intervals, work/rest |

## Library usage

```go
package main

import (
	"context"
	"fmt"
	"time"

	"github.com/shotah/go-garmin/garmin"
)

func main() {
	client := garmin.New(garmin.Options{})

	if err := client.Login(context.Background(), "email", "password"); err != nil {
		panic(err)
	}

	sleep, err := client.Sleep.GetDaily(context.Background(), time.Now())
	if err != nil {
		panic(err)
	}

	fmt.Printf("Sleep score: %d\n", sleep.SleepScores.Overall.Value)
}
```

Common service entry points on `*garmin.Client`:

`Sleep`, `Wellness`, `Activities`, `Weight`, `HRV`, `Metrics`, `FitnessAge`, `FitnessStats`, `Biometric`, `Devices`, `UserProfile`, `Workouts`, `Exercises`, `Calendar`, `Courses`, `UserSummary`, `PersonalRecords`, `TrainingPlans`, `Badges`, `BloodPressure`, `PeriodicHealth`, `Lifestyle`, `Golf`

## Architecture

Endpoints are defined once under `endpoint/definitions/` and registered in `endpoint/definitions/register.go`. From that registry the project generates:

- CLI commands (`endpoint.CLIGenerator`)
- MCP tools (`endpoint.MCPGenerator`)
- Completeness checks (`endpoint.Validator`)

See [AGENTS.md](AGENTS.md) for the add-an-endpoint workflow, and [ENDPOINTS.md](ENDPOINTS.md) for the Garmin API coverage checklist.

## Development

```bash
make help                 # list targets
make tools                # install goimports-reviser + golangci-lint v2
make install-hooks        # git pre-commit: autofix + lint + validate + test
make check                # same checks as the pre-commit hook
make validate-endpoints   # endpoint registry completeness
make cli                  # build ./bin/garmin

# Fixture recording + VCR integration tests (auth required first)
make auth                 # interactive login → settings.json (required)
make fixtures             # record/update VCR cassettes
make fixtures CASSETTE=metrics
make test-integration     # go test -tags=integration (needs auth + fixtures)
```

## Releasing

Go modules are **not** published to GitHub Packages. The current release is tracked in [`VERSION`](VERSION) and as a git tag.

```bash
make version                 # show VERSION file + latest tag
make release                 # patch bump (v0.1.0 → v0.1.1), commit VERSION, tag, push
make release BUMP=minor      # v0.1.0 → v0.2.0
make release BUMP=major      # v0.1.0 → v1.0.0
make release TAG=v0.2.0      # set an explicit version
make release DRY_RUN=1       # print next version only
```

Working tree must be clean (commit golf/other work first). Pushing the `v*` tag runs **GoReleaser** and publishes multi-platform CLI binaries to [GitHub Releases](https://github.com/shotah/go-garmin/releases).

Install a released version:

```bash
go get github.com/shotah/go-garmin@v0.1.0
go install github.com/shotah/go-garmin/cmd/garmin@v0.1.0
```

CI runs on every PR/push to `main` (build, lint, endpoint validation, unit tests).

## License

MIT

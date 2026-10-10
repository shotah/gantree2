<p align="center">
  <img src="docs/assets/banner.svg" alt="google-health-mcp — sleep · activity · recovery" width="100%">
</p>

# google-health-mcp

<p align="center">
  <a href="https://github.com/shotah/google-health-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/google-health-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shotah/google-health-mcp/actions/workflows/release.yml"><img src="https://github.com/shotah/google-health-mcp/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/shotah/google-health-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/google-health-mcp/raw/gh-pages/badges/coverage.svg" alt="Coverage"></a>
  <a href="https://pkg.go.dev/github.com/shotah/google-health-mcp"><img src="https://pkg.go.dev/badge/github.com/shotah/google-health-mcp.svg" alt="Go Reference"></a>
  <img src="https://img.shields.io/github/go-mod/go-version/shotah/google-health-mcp" alt="Go version">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shotah/google-health-mcp" alt="License"></a>
</p>

Static Go [MCP](https://modelcontextprotocol.io) for **Google Health** data
from modern **Fitbit / Pixel Watch** devices via the
[Google Health API](https://developers.google.com/health/about)
(`health.googleapis.com`).

Built for [ai-gantry](https://github.com/shotah/ai-gantry) / LOCAL_AGENT: lean
**core** tool surface (Garmin-shaped nouns), stdio only, `CGO_ENABLED=0`.
**Read + summarize — never writes fake workouts.**

Naming follows
[ai-gantry MCP tool naming](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md):
host server id `ghealth` → tools like `ghealth__sleep_get` (tool names do
**not** repeat the server id).

## New school only

| Path | This package? |
| --- | --- |
| **Google Health API** + Google OAuth 2.0 | ✅ Yes |
| Legacy Fitbit Web API (FOT auth) | ❌ Turned down Sept 2026 — skip |
| Google Fit REST | ❌ Closed to new apps — skip |
| Health Connect (on-device Android) | ❌ Wrong shape for stdio MCP |

Friends on the new Google/Fitbit line sync through the Fitbit app → data is
available on **Google Health API**. Chris keeps [`go-garmin`](https://github.com/shotah/go-garmin).

Background: [docs/why-google-health.md](docs/why-google-health.md).

## Tools (core tier)

| Tool | Google Health data type(s) |
| --- | --- |
| `sleep_get` | `sleep` (reconcile) |
| `activities_list` | `exercise` (list / reconcile) |
| `activities_get` | `exercise` get by name |
| `heart_rate_get` | `daily-resting-heart-rate` (+ optional `heart-rate`) |
| `hrv_get` | `daily-heart-rate-variability` |
| `weight_get` | `weight` |
| `profile_get` | identity / profile |
| `account_get` | auth / token status |

Host: `ghealth__sleep_get`, `ghealth__activities_list`, …

### Agent contract

```text
sleep_get / heart_rate_get / hrv_get  → recovery
  last night / today: omit date
  a span: after_date + before_date once (sessions[] / entries[])
activities_list → activities_get     → “what did I do?”
weight_get                           → scale (period already a series)
```

The Google Health app’s 0–100 Sleep Score is **not** on `dataTypes/sleep`
(no `sleep-score` data type either). `sleep_get` returns the session the API
does expose: duration, `stages_minutes`, and `efficiency`
(`round(minutes asleep / minutes in the sleep period × 100)`). It does not
invent a score.

Same recipes as `garmin__…` — swap prefix for Fitbit friends.

## Setup

1. Personal GCP project →
   [enable Google Health API](https://console.cloud.google.com/apis/library/health.googleapis.com)
   → OAuth Web client ([setup](https://developers.google.com/health/setup)).
2. Authorized redirect URI:
   `http://127.0.0.1:4101/oauth2callback`
3. Add **readonly** scopes you need on the Data Access page (Restricted —
   testing limited to ~100 users until verification).
4. Export:

```bash
export GOOGLE_HEALTH_CLIENT_ID=...
export GOOGLE_HEALTH_CLIENT_SECRET=...
# after auth (optional — $DATA_DIR/.config/ghealth/tokens.json is the gantry default):
# export GOOGLE_HEALTH_TOKEN_PATH=...
```

5. Auth (on the machine with your browser):

```bash
google-health-mcp auth
# Docker / ai-gantry: make ghealth-auth  → publishes localhost:4101
```

PKCE + loopback → tokens on disk.

### Core scopes (readonly)

```text
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
https://www.googleapis.com/auth/googlehealth.profile.readonly
```

### Boot safety

MCP **starts even if tokens are missing**. Data tools return a clear auth
error. Optional fitness MCP must not take Tim down.

## Development

```bash
make help
make tools
make check
make cli
make self-test
```

Status: live `health.googleapis.com/v4` client (reconcile + wearables filter) +
OAuth CLI. See [TODO.md](TODO.md) for release / ai-gantry wiring.

## ai-gantry wiring

```toml
[[server]]
name = "ghealth"
command = "google-health-mcp"
auth_args = ["auth"]
download_tag = "latest"
download_url = "https://github.com/shotah/google-health-mcp/releases/download/{tag}/google-health-mcp_{version}_{os}_{arch}.tar.gz"
```

## License

MIT

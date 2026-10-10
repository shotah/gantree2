# Design — google-health-mcp

## Goal

Give friends on modern Fitbit / Pixel Watch the same LOCAL_AGENT
recovery/activity recipes Chris gets from Garmin — small, name-stable MCP
surface over **Google Health API**.

Sibling packaging of [`cars-search-mcp`](../../cars-search-mcp) /
[`rentals-search-mcp`](../../rentals-search-mcp); domain cousin of
[`go-garmin`](../../go-garmin) (but **lean core**, not 100 endpoints).

## Transport choice

| Option | Fit | Notes |
| --- | --- | --- |
| **Google Health API** | ✅ Chosen | `health.googleapis.com/v4`, Google OAuth, reconcile |
| Fitbit Web API | ❌ Skip | EOS ~Sept 2026 |
| Google Fit REST | ❌ Skip | No new apps |
| Health Connect | ❌ Skip | On-device only |

See [why-google-health.md](why-google-health.md).

## Host naming

| Layer | Value |
| --- | --- |
| Folder / binary | `google-health-mcp` |
| Host `mcp.toml` `name` | `ghealth` |
| Tools | `sleep_get`, `activities_list`, … |
| Host-facing | `ghealth__sleep_get` |

Shared nouns with garmin — **host prefix** disambiguates
(`garmin__sleep_get` vs `ghealth__sleep_get`). Never steal `calendar_*`
(Google Calendar lives on `google__`).

## Core tool → data type map

| Tool | Prefer |
| --- | --- |
| `sleep_get` | `sleep` reconcile + wearables family |
| `activities_list` / `_get` | `exercise` |
| `heart_rate_get` | `daily-resting-heart-rate` |
| `hrv_get` | `daily-heart-rate-variability` |
| `weight_get` | `weight` |
| `profile_get` | getIdentity / profile |
| `account_get` | local token status |

Default date behavior matches garmin recipes:

- “Last night’s sleep” → omit date or pass **today** (wake-up day)
- A span of sleep, resting HR, or HRV → `after_date` (inclusive) + `before_date` (exclusive) in **one** call; read `sessions[]` / `entries[]`
- Activity day bounds in the human’s timezone from `[current time]`

The app Sleep Score (0–100) is not a field on `sleep`. `sleep_get` returns duration, stage minutes, and `efficiency` (`round(minutes asleep / minutes in the sleep period × 100)`). It does not invent a score.

## Auth

Google OAuth 2.0 (authorization code + PKCE for desktop/loopback).

```text
GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET
→ google-health-mcp auth → GOOGLE_HEALTH_TOKEN_PATH
```

ai-gantry: `auth_args = ["auth"]` like strava/youtube → `gantry auth ghealth`.

## Boot safety

Do not require tokens before MCP `initialize`. Pair with gantry fail-soft boot.

## Package layout

```text
google-health-mcp/
  cmd/google-health-mcp/   # stdio + auth
  cmd/release/
  internal/mcp/            # tools
  internal/ghealth/        # Health API + OAuth client
  docs/
```

## Non-goals for MVP

- Write scopes / inventing workouts
- Nutrition, ECG, reproductive health
- Legacy Fitbit Web API bridge
- Health Connect bridge

# Why Google Health API (not Fitbit Web, not Google Fit)

## Short answer

Friends on the **new Google / Fitbit** line should use
[Google Health API](https://developers.google.com/health/about)
(`health.googleapis.com/v4`) + **Google OAuth 2.0**.

| Path | Status for a new MCP in 2026 |
| --- | --- |
| **Google Health API** | ✅ Build here |
| Legacy **Fitbit Web API** (FOT) | ❌ Sunsets ~Sept 2026; tokens do not carry over |
| **Google Fit REST** | ❌ Closed to new developer signups |
| **Health Connect** | ❌ On-device Android — wrong shape for stdio MCP |

## What “Google Health” actually is

Uniform resource shape:

```text
GET https://health.googleapis.com/v4/users/me/dataTypes/{type}/dataPoints
GET …/dataPoints:reconcile          # merged stream (app-like)
GET …/dataPoints                    # list raw
POST …/dataPoints:dailyRollUp       # civil-day aggregates
POST …/dataPoints:rollUp            # physical-time aggregates
```

Wearable-only filter (Fitbit trackers / Pixel Watch):

```text
dataSourceFamily=users/me/dataSourceFamilies/google-wearables
```

Example sleep (from Google docs):

```text
GET …/dataTypes/sleep/dataPoints:reconcile
  ?dataSourceFamily=users/me/dataSourceFamilies/google-wearables
  &filter=sleep.interval.civil_end_time >= "2026-03-03"
```

## Scopes (Restricted)

MVP readonly:

```text
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
https://www.googleapis.com/auth/googlehealth.profile.readonly
```

Until Google verification, testing is capped (~100 users). Fine for friends.

**OAuth tip:** request only `googlehealth.*` scopes. Mixing legacy Google Fit
`fitness.*` scopes on the same client can break data-plane reads.

## Identity

Token response may not include Fitbit/Google user ids — call **getIdentity**
(profile) after auth.

## vs Garmin

Chris stays on [`go-garmin`](https://github.com/shotah/go-garmin). This package
keeps the **same tool nouns** (`sleep_get`, `activities_list`, …) so Tim can
swap `garmin__` ↔ `ghealth__` by wearer.

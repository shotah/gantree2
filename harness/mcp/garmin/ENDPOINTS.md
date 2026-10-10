# Garmin Connect API Endpoints

This document lists all known API endpoints from the reference projects and web research:
- [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
- [garth](https://github.com/matin/garth)
- [garmin-workouts](https://github.com/mkuthan/garmin-workouts)
- [garmin-connect (JS)](https://github.com/Pythe1337N/garmin-connect)
- [dotnet.garmin.connect](https://github.com/sealbro/dotnet.garmin.connect)

## Implementation Status

- [x] Implemented
- [ ] Not implemented

Each group below starts with a short “what this is for” note. Related API prefixes are merged into one section so duplicates (e.g. fitness age) aren’t split across the doc.

---

## Health & recovery

Sleep, daytime physiology, HRV, weight, and related health logging.
Use these for recovery dashboards and “how did I sleep / how stressed was I?” views. Prefer **User summary** (below) when you only need day totals.

### Sleep (`/sleep-service/`)

Night sleep stages, duration, and scores. Wellness also exposes an alternate sleep URL (same idea).

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/sleep-service/sleep/dailySleepData?date={date}` | Daily sleep data |

### Wellness (`/wellness-service/`)

Daytime charts and samples: stress, body battery, HR, SpO2, respiration, intensity, steps intervals, floors, events.
Leftover `epoch/request` only matters if a day’s samples look stuck after sync.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/wellness-service/wellness/dailyStress/{date}` | Daily stress and body battery data |
| [x] | GET | `/wellness-service/wellness/bodyBattery/events/{date}` | Body battery events |
| [x] | GET | `/wellness-service/wellness/dailyHeartRate/?date={date}` | Daily heart rate data |
| [x] | GET | `/wellness-service/wellness/daily/spo2/{date}` | Daily SpO2 data |
| [x] | GET | `/wellness-service/wellness/daily/respiration/{date}` | Daily respiration data |
| [x] | GET | `/wellness-service/wellness/daily/im/{date}` | Daily intensity minutes |
| [x] | GET | `/wellness-service/wellness/dailyEvents?calendarDate={date}` | Daily events |
| [x] | GET | `/wellness-service/wellness/dailySleepData/{displayName}?date={date}` | Daily sleep (alternative to sleep-service) |
| [x] | GET | `/wellness-service/wellness/dailySummaryChart/{displayName}?date={date}` | Daily summary chart (steps) |
| [x] | GET | `/wellness-service/wellness/floorsChartData/daily/{date}` | Floor climbing data |
| [ ] | POST | `/wellness-service/wellness/epoch/request/{date}` | Request epoch data reload |
| [x] | GET | `/wellness-service/wellness/bodyBattery/reports/daily?startDate={start}&endDate={end}` | Body battery reports |
| [x] | GET | `/wellness-service/stats/daily/sleep/score/{start}/{end}` | Sleep score stats |

Note: Some endpoints like `dailyHeartRate` can also use `/{displayName}?date={date}` format.

### HRV (`/hrv-service/`)

Heart-rate variability status, baseline, and ranges — core recovery signal.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/hrv-service/hrv/{date}` | Daily HRV data |
| [x] | GET | `/hrv-service/hrv/daily/{start}/{end}` | HRV range |

### Weight (`/weight-service/`)

Scale / body-composition history. Reads mostly done; add/delete weigh-ins for logging without the app.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/weight-service/weight/dayview/{date}` | Daily weight data |
| [x] | GET | `/weight-service/weight/range/{start}/{end}?includeAll=true` | Weight range |
| [ ] | GET | `/weight-service/weight/dateRange?startDate={start}&endDate={end}` | Weight date range (alternate) |
| [ ] | GET | `/weight-service/weight/daterangesnapshot` | Body composition snapshot |
| [ ] | POST | `/weight-service/user-weight` | Add weigh-in |
| [ ] | DELETE | `/weight-service/weight/{date}/byversion/{weightPK}` | Delete weigh-in |

### Blood pressure (`/bloodpressure-service/`)

Manual BP log history. Only useful if BP is logged in Connect.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/bloodpressure-service/bloodpressure/range/{start}/{end}` | Blood pressure range |
| [x] | POST | `/bloodpressure-service/bloodpressure` | Log blood pressure |
| [x] | DELETE | `/bloodpressure-service/bloodpressure/{date}/{version}` | Delete blood pressure |

### Menstrual / pregnancy (`/periodichealth-service/`)

Cycle tracking and pregnancy snapshot. Privacy-sensitive; skip unless that’s a product goal.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/periodichealth-service/menstrualcycle/dayview/{date}` | Menstrual day view |
| [x] | GET | `/periodichealth-service/menstrualcycle/calendar/{start}/{end}` | Menstrual calendar |
| [x] | GET | `/periodichealth-service/menstrualcycle/pregnancysnapshot` | Pregnancy snapshot |

### Lifestyle logging (`/lifestylelogging-service/`)

Subjective daily notes/mood alongside sensors. Low priority unless you want journaling context.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/lifestylelogging-service/dailyLog/{date}` | Daily log |
| [x] | POST | `/lifestylelogging-service/behaviours` | Create custom lifestyle behaviour |
| [ ] | — | Daily YES/NO behaviour log write | Needs Connect app HAR |

---

## Daily totals & goals

Home-screen aggregates and goal progress — prefer these over stitching many wellness calls when you only need “how was my day?”

### User summary (`/usersummary-service/`)

**Implemented.** One-shot daily totals (steps, calories, distance, floors, intensity, stress summary) plus hydration and multi-day step/stress/IM stats.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/usersummary-service/usersummary/daily/{displayName}?calendarDate={date}` | Daily user summary |
| [x] | GET | `/usersummary-service/usersummary/hydration/daily/{date}` | Daily hydration |
| [x] | PUT | `/usersummary-service/usersummary/hydration/log` | Log/update hydration |
| [x] | GET | `/usersummary-service/stats/steps/daily/{start}/{end}` | Daily steps stats (max 28 days; longer ranges chunked) |
| [x] | GET | `/usersummary-service/stats/steps/weekly/{end}/{weeks}` | Weekly steps stats |
| [x] | GET | `/usersummary-service/stats/stress/daily/{start}/{end}` | Daily stress stats |
| [x] | GET | `/usersummary-service/stats/stress/weekly/{end}/{weeks}` | Weekly stress stats |
| [x] | GET | `/usersummary-service/stats/hydration/daily/{start}/{end}` | Hydration stats |
| [x] | GET | `/usersummary-service/stats/im/daily/{start}/{end}` | Daily intensity minutes |
| [x] | GET | `/usersummary-service/stats/im/weekly/{start}/{end}` | Weekly intensity minutes |

Note: `daily/{displayName}` can also be accessed as `daily/?calendarDate={date}` (garth variant).

### User stats (`/userstats-service/`)

Smaller metric-series API (e.g. resting HR over dates). Overlaps wellness/metrics; only if you need this specific path.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [ ] | GET | `/userstats-service/wellness/daily/{displayName}?fromDate={date}&untilDate={date}&metricId=60` | Daily wellness stats (RHR) |

### Goals (`/goal-service/`)

Step/intensity (etc.) targets and progress — “am I on track today?”

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [ ] | GET | `/goal-service/goal/goals?status={status}` | Get goals |

---

## Activities

Find activities, inspect them, export files, and (optionally) upload/edit.

### Activity list (`/activitylist-service/`)

Search/list/count and filter by gear. Search covers most CLI/MCP needs.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/activitylist-service/activities/search/activities?start={start}&limit={limit}` | Search activities |
| [ ] | GET | `/activitylist-service/activities/` | List activities |
| [ ] | GET | `/activitylist-service/activities/count` | Activity count |
| [ ] | GET | `/activitylist-service/activities/{gearUUID}/gear?start={start}&limit={limit}` | Activities for gear |

### Activity detail (`/activity-service/`)

Per-activity splits, weather, zones, exercise sets. Reads are solid; writes matter only if editing Connect from tools.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/activity-service/activity/{activityId}` | Get single activity |
| [x] | GET | `/activity-service/activity/{activityId}/details?maxChartSize={n}&maxPolylineSize={n}` | Activity details (time-series) |
| [x] | GET | `/activity-service/activity/{activityId}/splits` | Activity splits |
| [x] | GET | `/activity-service/activity/{activityId}/typedsplits` | Activity typed splits |
| [x] | GET | `/activity-service/activity/{activityId}/split_summaries` | Activity split summaries |
| [x] | GET | `/activity-service/activity/{activityId}/weather` | Activity weather |
| [x] | GET | `/activity-service/activity/{activityId}/hrTimeInZones` | HR time in zones |
| [x] | GET | `/activity-service/activity/{activityId}/powerTimeInZones` | Power time in zones |
| [x] | GET | `/activity-service/activity/{activityId}/exerciseSets` | Exercise sets |
| [x] | GET | `/activity-service/activity/activityTypes` | Activity types |
| [ ] | POST | `/activity-service/activity` | Create manual activity |
| [ ] | PUT | `/activity-service/activity/{activityId}` | Update activity (name, type, etc.) |
| [ ] | DELETE | `/activity-service/activity/{activityId}` | Delete activity |

Note: `typedsplits` is lowercase 'd' in the actual API.

### Download (`/download-service/`)

Export FIT/TCX/GPX/KML/CSV for backup or other platforms. Implemented.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/download-service/files/activity/{activityId}` | Download activity (original FIT) |
| [x] | GET | `/download-service/export/tcx/activity/{activityId}` | Export activity as TCX |
| [x] | GET | `/download-service/export/gpx/activity/{activityId}` | Export activity as GPX |
| [x] | GET | `/download-service/export/kml/activity/{activityId}` | Export activity as KML |
| [x] | GET | `/download-service/export/csv/activity/{activityId}` | Export activity as CSV |

### Upload (`/upload-service/`)

Import FIT/TCX/GPX into Connect — main unfinished activity write path for cross-platform sync.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [ ] | POST | `/upload-service/upload` | Upload activity file (FIT, TCX, GPX) |

---

## Training & performance

Coaching metrics, fitness age, volume aggregates, biometrics, and PRs.

### Metrics (`/metrics-service/`)

Training readiness, endurance/hill score, VO2 max, race predictions, training status/load, heat/altitude acclimation.
Leftovers are mostly history/range variants of metrics you already have for a single day.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/metrics-service/metrics/trainingreadiness/{date}` | Training readiness |
| [x] | GET | `/metrics-service/metrics/endurancescore?calendarDate={date}` | Endurance score |
| [x] | GET | `/metrics-service/metrics/endurancescore/stats?startDate={start}&endDate={end}&aggregation={agg}` | Endurance score stats |
| [x] | GET | `/metrics-service/metrics/hillscore?calendarDate={date}` | Hill score |
| [x] | GET | `/metrics-service/metrics/hillscore/stats?startDate={start}&endDate={end}&aggregation={agg}` | Hill score stats |
| [x] | GET | `/metrics-service/metrics/racepredictions/latest/{displayName}` | Latest race predictions (requires display name) |
| [x] | GET | `/metrics-service/metrics/racepredictions/daily/{displayName}?_={timestamp}` | Daily race predictions |
| [x] | GET | `/metrics-service/metrics/racepredictions/monthly/{displayName}?_={timestamp}` | Monthly race predictions |
| [x] | GET | `/metrics-service/metrics/maxmet/daily/{start}/{end}` | Daily VO2 max/MET |
| [x] | GET | `/metrics-service/metrics/maxmet/latest/{date}` | Latest VO2 max/MET |
| [x] | GET | `/metrics-service/metrics/trainingstatus/aggregated/{date}` | Training status aggregated |
| [x] | GET | `/metrics-service/metrics/trainingstatus/daily/{date}` | Daily training status |
| [x] | GET | `/metrics-service/metrics/trainingloadbalance/latest/{date}` | Training load balance |
| [x] | GET | `/metrics-service/metrics/heataltitudeacclimation/latest/{date}` | Heat/altitude acclimation |

### Fitness age (`/fitnessage-service/`)

Garmin’s “fitness age” vs chronological age (single day + daily stats range). One service — previously split in this doc.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/fitnessage-service/stats/daily/{start}/{end}` | Daily fitness age statistics |
| [x] | GET | `/fitnessage-service/fitnessage/{date}` | Fitness age (single day) |

### Fitness stats (`/fitnessstats-service/`)

Aggregated activity volume (distance, calories, duration, …) by day/week/month without pulling every activity.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/fitnessstats-service/activity?aggregation={agg}&startDate={start}&endDate={end}&metric={metric}...` | Activity fitness stats |

### Biometric (`/biometric-service/`)

Lactate threshold, FTP, power-to-weight, HR zones — serious run/bike training. Largely implemented.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/biometric-service/biometric/latestLactateThreshold` | Latest lactate threshold |
| [x] | GET | `/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING` | Latest cycling FTP |
| [x] | GET | `/biometric-service/biometric/powerToWeight/latest/{date}?sport=Running` | Power-to-weight ratio |
| [x] | GET | `/biometric-service/stats/lactateThresholdSpeed/range/{start}/{end}?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST` | LT speed range |
| [x] | GET | `/biometric-service/stats/lactateThresholdHeartRate/range/{start}/{end}?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST` | LT heart rate range |
| [x] | GET | `/biometric-service/stats/functionalThresholdPower/range/{start}/{end}?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST` | FTP range |
| [x] | GET | `/biometric-service/heartRateZones/` | Heart rate zones for all sports |

### Personal records (`/personalrecord-service/`)

All-time PRs (fastest 5K, etc.). Nice for “show my bests”; not required for daily ops.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/personalrecord-service/personalrecord/prs/{displayName}` | Personal records (requires display name) |

---

## Workouts & planning

Structured workouts, guided plans, and the calendar that ties them together.

### Workouts (`/workout-service/`)

List/create/update/delete workouts, FIT download, schedule onto a date. Implemented.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/workout-service/workouts?start={start}&limit={limit}` | List workouts |
| [x] | GET | `/workout-service/workout/{workoutId}` | Get workout |
| [x] | GET | `/workout-service/workout/FIT/{workoutId}` | Download workout as FIT |
| [x] | POST | `/workout-service/workout` | Create workout |
| [x] | PUT | `/workout-service/workout/{workoutId}` | Update workout |
| [x] | DELETE | `/workout-service/workout/{workoutId}` | Delete workout |
| [x] | POST | `/workout-service/schedule/{workoutId}` | Schedule workout (body: {"date": "YYYY-MM-DD"}) |
| [x] | GET | `/workout-service/schedule/{scheduleId}` | Get scheduled workout |

Note: Can also be accessed via `/proxy/workout-service/` prefix (garmin-workouts).

### Training plans (`/trainingplan-service/`)

Garmin Coach / phased / adaptive plans. Skip if you only manage standalone workouts.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/trainingplan-service/trainingplan/plans` | List training plans |
| [x] | GET | `/trainingplan-service/trainingplan/phased/{planId}` | Get phased training plan |
| [x] | GET | `/trainingplan-service/trainingplan/fbt-adaptive/{planId}` | Get FBT adaptive plan |

### Calendar (`/calendar-service/`)

Month/day view of activities, workouts, weight, and related items. Implemented.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/calendar-service/year/{year}/month/{month}/day/{day}/start/{start}` | Calendar data with hierarchical optional params |

Note: Parameters are hierarchical — month requires year, day requires month, start requires day.

---

## Profile, devices & gear

Who you are, what you wear, and equipment mileage.

### User profile (`/userprofile-service/`)

Display name, units, privacy — required for many `{displayName}` URLs.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/userprofile-service/socialProfile` | Social profile (displayName, fullName) |
| [x] | GET | `/userprofile-service/userprofile/user-settings` | User settings (measurementSystem) |
| [x] | GET | `/userprofile-service/userprofile/settings` | Profile settings |
| [ ] | GET | `/userprofile-service/userprofile/profile` | User profile details (often redundant) |

### Devices (`/device-service/` + `/web-gateway/`)

Paired watches/sensors, settings, messages, primary training device, solar charge history.
Solar is device-specific; `mylastused` is convenience only.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/device-service/deviceregistration/devices` | List devices |
| [x] | GET | `/device-service/deviceservice/device-info/settings/{deviceId}` | Device settings |
| [x] | GET | `/device-service/devicemessage/messages` | Device messages |
| [ ] | GET | `/device-service/deviceservice/mylastused` | Last used device |
| [x] | GET | `/web-gateway/device-info/primary-training-device` | Primary training device |
| [ ] | GET | `/web-gateway/solar/{deviceId}/{startDate}/{endDate}` | Solar panel data |

### Gear (`/gear-service/`)

Shoes/bikes inventory, stats, link/unlink to activities. Skip if you don’t track equipment.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [ ] | GET | `/gear-service/gear/filterGear?userProfilePk={pk}` | Get user gear |
| [x] | GET | `/gear-service/gear/filterGear?activityId={activityId}` | Get activity gear |
| [ ] | GET | `/gear-service/gear/stats/{gearUUID}` | Gear stats |
| [ ] | GET | `/gear-service/gear/user/{userProfilePk}/activityTypes` | Gear activity types |
| [ ] | POST | `/gear-service/gear/link/{gearUUID}/activity/{activityId}` | Link gear to activity |
| [ ] | POST | `/gear-service/gear/unlink/{gearUUID}/activity/{activityId}` | Unlink gear from activity |

Note: Gear activities are also listed via `/activitylist-service/activities/{gearUUID}/gear`.

---

## Badges & challenges

Gamification only — low value for health/training analysis. Kept together so they don’t look like separate product pillars.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/badge-service/badge/earned` | Earned badges |
| [x] | GET | `/badge-service/badge/available?showExclusiveBadge=true` | Available badges |
| [x] | GET | `/badgechallenge-service/badgeChallenge/completed?start={start}&limit={limit}` | Completed badge challenges |
| [x] | GET | `/badgechallenge-service/badgeChallenge/available?start={start}&limit={limit}` | Available badge challenges |
| [x] | GET | `/badgechallenge-service/badgeChallenge/non-completed?start={start}&limit={limit}` | Non-completed badge challenges |
| [x] | GET | `/badgechallenge-service/virtualChallenge/inProgress?start={start}&limit={limit}` | In-progress virtual challenges |
| [x] | GET | `/adhocchallenge-service/adHocChallenge/historical?start={start}&limit={limit}` | Historical ad-hoc challenges |

---

## Niche / alternate gateways

Only pursue if a specific audience or missing REST capability forces it.

### Golf (`/gcs-golfcommunity/api/v2/`)

Garmin Golf scorecards (community API used by Connect). CLI: `garmin golf …`.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [x] | GET | `/gcs-golfcommunity/api/v2/scorecard/summary?per-page={limit}&start={start}` | Golf round summaries |
| [x] | GET | `/gcs-golfcommunity/api/v2/scorecard/detail?scorecard-ids={id}&include-longest-shot-distance=true` | Scorecard detail |
| [x] | GET | `/gcs-golfcommunity/api/v2/shot/scorecard/{id}/hole?hole-numbers={holes}` | Shot-by-shot hole data |

### Mobile gateway (`/mobile-gateway/`)

App-oriented duplicates of HR / training status. Prefer wellness/metrics unless something only exists here.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [ ] | GET | `/mobile-gateway/heartRate/forDate/{date}` | Heart rate for date |
| [ ] | GET | `/mobile-gateway/usersummary/trainingstatus/latest/{date}` | Latest training status (unverified) |
| [ ] | GET | `/mobile-gateway/usersummary/trainingstatus/monthly/{start}/{end}` | Monthly training status (unverified) |
| [ ] | GET | `/mobile-gateway/usersummary/trainingstatus/weekly/{start}/{end}` | Weekly training status (unverified) |

Note: `heartRate/forDate` verified in python-garminconnect. Training status paths may be mobile-only.

### GraphQL gateway (`/graphql-gateway/`)

Modern Connect UI query API. Powerful but hard to reverse-engineer — last resort when REST is insufficient.

| Status | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| [ ] | POST | `/graphql-gateway/graphql` | GraphQL queries |

---

## Notes

1. All endpoints require authentication via OAuth2 Bearer token
2. Dates are typically in `YYYY-MM-DD` format
3. Some endpoints require `displayName` (username) as path parameter
4. Base URL is `https://connectapi.garmin.com` (or `https://connectapi.garmin.cn` for China)
5. Some endpoints use query parameters, others use path parameters
6. The `DI-Backend` header may be required for some endpoints

## Reference Projects

| Project | Language | URL |
|---------|----------|-----|
| python-garminconnect | Python | https://github.com/cyberjunky/python-garminconnect |
| garth | Python | https://github.com/matin/garth |
| garmin-workouts | Python | https://github.com/mkuthan/garmin-workouts |
| garmin-connect | JavaScript | https://github.com/Pythe1337N/garmin-connect |
| dotnet.garmin.connect | C# | https://github.com/sealbro/dotnet.garmin.connect |
| garmy | Python | https://github.com/bes-dev/garmy |

## Priority for Implementation

### Done / keep maintaining
1. Activities (search, get, details, download)
2. Wellness + sleep + HRV + weight reads
3. Metrics, biometrics, fitness stats/age (day+stats), workouts, calendar
4. Devices + profile
5. User summary (daily totals, hydration, step/stress/IM stats)
6. Personal records, training plans, badges/challenges
7. Hill score stats, race prediction daily/monthly
8. Blood pressure (read/write), menstrual/pregnancy, lifestyle GET (+ custom behaviour create)
9. Golf scorecards (summary, detail, shot data)

### High priority (remaining)
1. **Upload** — import FIT/TCX/GPX
2. **Goals** — on-track progress
3. Activity writes (create/update/delete) if editing Connect matters
4. Lifestyle daily YES/NO log write (needs Connect app HAR)

### Medium priority
1. Gear list/stats + link/unlink
2. Weight writes (add/delete weigh-in)
3. User stats RHR series

### Low priority
1. Mobile gateway duplicates
2. GraphQL gateway
3. Convenience leftovers (epoch reload, solar, last-used device)

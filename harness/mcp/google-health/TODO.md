# TODO — google-health-mcp

## Status

- [x] Local sibling folder (**no** `git init`, **no** GitHub, **no** push)
- [x] Pivot off legacy Fitbit Web API → **Google Health API** only
- [x] Docs: README + design + why-google-health + agent + ai-gantry
- [x] Compileable MCP stub + naming tests (Garmin-shaped core tools)
- [x] Lazy auth (missing tokens must not fail MCP `initialize`)
- [x] Google OAuth2 auth CLI (`google-health-mcp auth`)
- [x] Real `health.googleapis.com/v4` client (`reconcile` / `list` / `get`)
- [x] Tool handlers wired to data types below
- [x] Coverage ≥70%
- [x] Personal GitHub repo (manual — **never** work org)
- [x] First release (`v0.0.1`) + ai-gantry consumer PR

---

## MVP — core tier (new Fitbit / Pixel Watch friends)

| Tool | Host after | Google Health API |
| --- | --- | --- |
| `sleep_get` | `ghealth__sleep_get` | `GET .../dataTypes/sleep/dataPoints:reconcile` |
| `activities_list` | `ghealth__activities_list` | `exercise` list/reconcile |
| `activities_get` | `ghealth__activities_get` | `exercise` get by resource name |
| `heart_rate_get` | `ghealth__heart_rate_get` | `daily-resting-heart-rate` (± `heart-rate`) |
| `hrv_get` | `ghealth__hrv_get` | `daily-heart-rate-variability` |
| `weight_get` | `ghealth__weight_get` | `weight` list/reconcile |
| `profile_get` | `ghealth__profile_get` | getIdentity / profile |
| `account_get` | `ghealth__account_get` | local token status |

Checklist:

- [x] `{service}_{verb}_{object}` names; no `ghealth_` / `health_` tool prefix
- [x] Shared nouns with garmin (`sleep_`, `activities_`, `hrv_`, …)
- [x] OAuth with Google (not Fitbit FOT)
- [x] Prefer **reconcile** stream (matches Fitbit app) for reads
- [x] Optional `dataSourceFamily=google-wearables` filter
- [x] Civil-time filters for day windows (DST-safe)
- [x] Token refresh on disk (`GOOGLE_HEALTH_TOKEN_PATH`)

**Never in MVP:** write scopes, nutrition, ECG, reproductive health.

---

## Explicitly out of scope

| Item | Why |
| --- | --- |
| Legacy Fitbit Web API | EOS Sept 2026 — do not build |
| Google Fit REST | Closed to new developers |
| Health Connect bridge | On-device Android, not stdio MCP |

---

## Publishing (personal account only)

1. `cd c:\workspace\google-health-mcp`
2. `git init` + `make tools && make install-hooks`
3. Create **personal** GH repo → push
4. `make release TAG=v0.0.1`
5. Wire ai-gantry `mcp.toml` + `local-agent/docs/google-health.md`

Note: Restricted scopes → OAuth verification + security assessment before >100
users. Fine for friends/testing under the 100-user cap.

---

## v2 ideas

- [ ] Steps / AZM / VO2 daily rollups
- [ ] `--tool-tier core|full`
- [ ] Webhooks (probably not for LOCAL_AGENT)
- [ ] SpO2 / respiratory rate

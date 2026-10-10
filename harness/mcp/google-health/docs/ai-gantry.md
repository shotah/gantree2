# ai-gantry wiring — google-health-mcp

Published as [shotah/google-health-mcp](https://github.com/shotah/google-health-mcp)
(`v0.0.1`+). Consumer wiring lives in ai-gantry `local-agent/`.

## `mcp.toml`

```toml
# Google Health / Fitbit+Pixel Watch (shotah/google-health-mcp) — docs/google-health.md
# Core tier. Auth via gantry auth ghealth.
[[server]]
name = "ghealth"
command = "google-health-mcp"
auth_args = ["auth"]
download_tag = "latest"
download_url = "https://github.com/shotah/google-health-mcp/releases/download/{tag}/google-health-mcp_{version}_{os}_{arch}.tar.gz"
```

## Env (planned)

```bash
GOOGLE_HEALTH_CLIENT_ID=...
GOOGLE_HEALTH_CLIENT_SECRET=...
# optional — default is $DATA_DIR/.config/ghealth/tokens.json when DATA_DIR is set
# GOOGLE_HEALTH_TOKEN_PATH=/opt/gantry/data/.config/ghealth/tokens.json
# GOOGLE_HEALTH_MCP_VERSION=v0.0.1
```

After deploy: `gantry auth ghealth` so tokens land on the host.

## Host tool names

| Tool binary | Host |
| --- | --- |
| `sleep_get` | `ghealth__sleep_get` |
| `activities_list` | `ghealth__activities_list` |
| `activities_get` | `ghealth__activities_get` |
| `heart_rate_get` | `ghealth__heart_rate_get` |
| `hrv_get` | `ghealth__hrv_get` |
| `weight_get` | `ghealth__weight_get` |
| `profile_get` | `ghealth__profile_get` |
| `account_get` | `ghealth__account_get` |

Update ai-gantry `docs/mcp-naming.md` with a `ghealth` row when shipping.

## GCP notes for LOCAL_AGENT

1. Personal GCP project → enable **Google Health API**.
2. OAuth Web client; add loopback redirect for CLI auth.
3. Data Access page: request **readonly** scopes above (Restricted).
4. Keep under 100 test users until verification — fine for friends.

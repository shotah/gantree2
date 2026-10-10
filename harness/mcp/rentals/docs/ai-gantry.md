# ai-gantry consumer wiring

**Do this only after** the binary exists on a **personal** GitHub release
(or you bake a local binary into the image). Do not point `download_url` at a
work org.

Agent recipes (TOOLS.md sketch, tool cheat sheet): **[agent.md](agent.md)**.

## `mcp.toml`

```toml
# Residential listings — rent or buy (shotah/rentals-search-mcp) — docs/rentals.md
# Recommend-only: listings + rent estimate + market stats. No applications or offers.
[[server]]
name = "rentals"
command = "rentals-search-mcp"
download_tag = "latest"
download_url = "https://github.com/shotah/rentals-search-mcp/releases/download/{tag}/rentals-search-mcp_{version}_{os}_{arch}.tar.gz"
```

## Env

```bash
RENTCAST_API_KEY=...
# Optional pin for Docker bake / native fetch:
# RENTALS_SEARCH_MCP_VERSION=v0.0.1

# Local usage counter + caps (optional). In Docker, mount a volume or counts reset:
# RENTCAST_USAGE_FILE=/data/rentcast-usage.json
# RENTCAST_MONTHLY_QUOTA=50
# RENTCAST_SOFT_CAP=40
# RENTCAST_ALLOW_OVERAGE=1
# RENTCAST_USAGE_TRACK=0   # also disables soft/hard caps
```

Docker/distroless: API key via env only. Local `usage` undercounts if the
usage file is not on a persistent volume — prefer the RentCast dashboard for
hard quota decisions.

## Persona

Paste the **TOOLS.md sketch** from [agent.md](agent.md) into
`local-agent/persona/TOOLS.md`. Keep
[local-agent/docs/rentals.md](https://github.com/shotah/ai-gantry/blob/main/local-agent/docs/rentals.md)
in sync when shipping the consumer PR.

## Host tool names

| Tool | Host |
| --- | --- |
| `listings_search` | `rentals__listings_search` |
| `listings_get` | `rentals__listings_get` |
| `rent_estimate_get` | `rentals__rent_estimate_get` |
| `markets_get` | `rentals__markets_get` |
| `areas_resolve` | `rentals__areas_resolve` |
| `link_format` | `rentals__link_format` |
| `account_get` | `rentals__account_get` |

Update [ai-gantry `docs/mcp-naming.md`](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md)
host table with a `rentals` row when shipping the consumer PR.

## Cost reminder

RentCast Developer ≈ **50 requests/month**. Soft cap (40) requires
`confirm_spend=true` on each remaining billed call; hard cap (50) cannot be
unlocked by the model. Prefer one tight `listings_search` over many exploratory
pages. `areas_resolve`, `link_format`, and `account_get` are free (no RentCast
call).

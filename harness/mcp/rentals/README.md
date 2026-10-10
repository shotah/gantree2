<p align="center">
  <img src="docs/assets/banner.svg" alt="rentals-search-mcp — search · recommend · handoff" width="100%">
</p>

# rentals-search-mcp

<p align="center">
  <a href="https://github.com/shotah/rentals-search-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/rentals-search-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shotah/rentals-search-mcp/actions/workflows/release.yml"><img src="https://github.com/shotah/rentals-search-mcp/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/shotah/rentals-search-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/rentals-search-mcp/raw/gh-pages/badges/coverage.svg" alt="Coverage"></a>
  <a href="https://pkg.go.dev/github.com/shotah/rentals-search-mcp"><img src="https://pkg.go.dev/badge/github.com/shotah/rentals-search-mcp.svg" alt="Go Reference"></a>
  <img src="https://img.shields.io/github/go-mod/go-version/shotah/rentals-search-mcp" alt="Go version">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shotah/rentals-search-mcp" alt="License"></a>
</p>

Static Go [MCP](https://modelcontextprotocol.io) for **US residential listing
search** — long-term rentals **or** homes for sale (apartments, houses, condos,
townhomes) via the [RentCast API](https://developers.rentcast.io/reference/introduction).

Built for [ai-gantry](https://github.com/shotah/ai-gantry) / LOCAL_AGENT: lean
tool surface, stdio only, `CGO_ENABLED=0` binary that fits distroless.
**Search + recommend + listing handoff — never applies, makes offers, contacts
landlords/agents, or signs anything.**

Naming follows
[ai-gantry MCP tool naming](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md):
host server id `rentals` → tools like `rentals__listings_search` (tool names do
**not** repeat the server id).

> **Publish from a personal GitHub account only** (never a work org). CI /
> GoReleaser / badges are scaffolded and light up after the personal remote
> exists — see [TODO.md](TODO.md).

## What this is (and is not)

| In scope | Out of scope |
| --- | --- |
| Long-term **for-rent** and **for-sale** residential listings (US) | Short-term / vacation stays (Airbnb, Google Hotels) |
| Apartments, houses, condos, townhomes, multi-family (+ land when buying) | Retail / office / industrial **commercial** leases |
| Rent estimates + zip rental market stats | Applying, touring, offers, escrow, or signing |
| Listing URL / contact handoff | Acting as the renter or buyer |

Commercial / tiny retail spaces (e.g. a small Seattle grocery mart) need a
**different** data source and almost certainly a **different MCP package** —
see [docs/commercial-spaces.md](docs/commercial-spaces.md).

## Tools (MVP)

| Tool | Description |
| --- | --- |
| `listings_search` | **For-rent by default** (`/listings/rental/long-term`); pass `intent=buy` only for sale. City/zip/neighborhood + beds/price/type |
| `listings_get` | One listing by RentCast listing id (**same `intent`** — sale and rental catalogs differ) |
| `rent_estimate_get` | Long-term rent AVM for an address (+ comps when available) |
| `markets_get` | Aggregate rent / listing stats for a US zip code |
| `areas_resolve` | Local neighborhood → zips / lat/lng (Seattle presets; no API) |
| `link_format` | Fallback public search URL (no API call) |
| `account_get` | Local usage counter (used/left/cap_state) + dashboard link — RentCast has no public quota API |

Host names: `rentals__listings_search`, `rentals__listings_get`,
`rentals__rent_estimate_get`, `rentals__markets_get`, `rentals__areas_resolve`,
`rentals__link_format`, `rentals__account_get`.

### Agent contract

```text
ASK if they want to buy → [areas_resolve] → listings_search (defaults to rent) → [listings_get] → handoff
                                              ↘ markets_get / rent_estimate_get (rent context)
```

1. **For-rent by default:** `listings_search` / `listings_get` / `link_format`
   hit the long-term rental catalog unless you pass `intent=buy`.
   `price_min` / `price_max` are monthly rent when renting and purchase price
   when buying.
2. **Where + budget:** `listings_search` with `city`+`state`, `zip_code` /
   `zip_codes`, or `neighborhood` (e.g. `Capitol Hill`), plus beds/price/type.
   Use `new_this_week` or `days_old_max` for fresh listings.
3. **Neighborhoods:** `areas_resolve` (`list_all=true` or `neighborhood=Ballard`)
   when the human names a Seattle area — then pass `neighborhood` into search.
4. **Detail:** `listings_get` when the human picks a candidate id (same `intent`).
5. **Context (optional):** `markets_get` for zip **rental** averages;
   `rent_estimate_get` when comparing a specific address to “fair rent”.
6. **Handoff:** give the human `agent` / `office` (name, phone, email, website).
   RentCast has no portal listing URL; `search_url` is a Google address fallback.
   Do **not** impersonate the renter or buyer, apply, or make offers.

`pets_wanted` / `parking_wanted` / `laundry_wanted` are **soft preferences only**
— RentCast does not expose those filters; confirm with the listing agent/office.

## Setup

1. Create a [RentCast](https://www.rentcast.io/api) account (Developer plan =
   **50 free API requests / month**).
2. Export the key:

```bash
export RENTCAST_API_KEY=...
# optional (tests / proxies):
# export RENTCAST_BASE_URL=https://api.rentcast.io/v1
# optional caps (defaults shown):
# export RENTCAST_MONTHLY_QUOTA=50
# export RENTCAST_SOFT_CAP=40
# export RENTCAST_ALLOW_OVERAGE=1   # human-only; paid plan / intentional overage
```

Billed tools (`listings_search`, `listings_get`, `rent_estimate_get`,
`markets_get`) are **gated before any HTTP**:

| Cap | Default | What happens | Who can continue |
| --- | --- | --- | --- |
| Soft | 40 used | Error: re-call the **same** tool with `confirm_spend=true` | The model (explicit bump on each remaining call) |
| Hard | 50 used | Error: do not retry; use `link_format` or wait for `period_resets` | A **human** setting `RENTCAST_ALLOW_OVERAGE=1` in MCP env — not a tool |

A lock file the model can reset would not protect the free tier: if the model
can clear it, it will, and you still go over 50. The hard cap lives in the
HTTP client and cannot be unlocked from a tool.

`RENTCAST_USAGE_TRACK=0` disables the counter **and** both caps.

### Docker / containers

The binary is static (`CGO_ENABLED=0`) and fine in distroless — pass
`RENTCAST_API_KEY` via env/secrets, never bake it into the image.

**Local usage counter caveat:** `account_get` / search `usage` persist under
`RENTCAST_USAGE_FILE` (default: OS user config dir). In Docker that path is
usually **ephemeral** (or unwritable in distroless), so counts (and therefore
caps) reset on recreate and can **undercount** real RentCast spend. Mitigations:

- Mount a volume and set `RENTCAST_USAGE_FILE=/data/rentcast-usage.json`, or
- Treat the dashboard as source of truth and/or set `RENTCAST_USAGE_TRACK=0`
  (that also turns **off** the soft/hard caps)

Multiple containers without a shared usage file each keep their own counter.

## Development

```bash
make help                 # list targets
make tools                # install goimports-reviser + golangci-lint v2
make install-hooks        # git pre-commit: autofix + lint + test + coverage ≥70%
make check                # same checks as the pre-commit hook
make cli                  # static binary → ./bin/rentals-search-mcp
make self-test
```

Hooks, tests, and `make tools` run with `CGO_ENABLED=0` (same as the shipped
binary). That matters on SteamOS and other hosts that have `gcc` but no libc
headers — otherwise Go's `net` package tries cgo and fails.

Coverage **≥70%** is mandatory locally (`make coverage` / pre-commit) and in CI.

Status: **MVP client wired**. US-wide long-term residential search (Seattle is just
the first use case). Remaining publish steps are in [TODO.md](TODO.md).

## Releasing

GoReleaser publishes static binaries on `v*` tags (see `.github/workflows/release.yml`).
Requires a personal GitHub remote first.

```bash
make version                 # show VERSION + next patch (dry-run)
make release                 # patch bump, commit VERSION, tag, push
make release BUMP=minor
make release TAG=v0.1.0
```

Archive name for ai-gantry `download_url`:

```text
rentals-search-mcp_{version}_{os}_{arch}.tar.gz
```

## Run as MCP (stdio)

```bash
./bin/rentals-search-mcp
```

Logs go to **stderr** only — stdout is reserved for the MCP protocol.

Example Cursor / client config:

```json
{
  "mcpServers": {
    "rentals": {
      "command": "rentals-search-mcp",
      "env": {
        "RENTCAST_API_KEY": "…"
      }
    }
  }
}
```

## ai-gantry wiring (when published)

```toml
[[server]]
name = "rentals"
command = "rentals-search-mcp"
download_tag = "latest"
download_url = "https://github.com/shotah/rentals-search-mcp/releases/download/{tag}/rentals-search-mcp_{version}_{os}_{arch}.tar.gz"
```

Do **not** publish this to a work GitHub org. Use a personal account / org
(module path assumes `shotah`).

More consumer notes: [docs/ai-gantry.md](docs/ai-gantry.md).
Agent tool recipes / TOOLS.md sketch: [docs/agent.md](docs/agent.md).

## License

MIT

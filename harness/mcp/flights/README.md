<p align="center">
  <img src="docs/assets/banner.svg" alt="flights-search-mcp — search · recommend · checkout" width="100%">
</p>

# flights-search-mcp

<p align="center">
  <a href="https://github.com/shotah/flights-search-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/flights-search-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shotah/flights-search-mcp/actions/workflows/release.yml"><img src="https://github.com/shotah/flights-search-mcp/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/shotah/flights-search-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/flights-search-mcp/raw/gh-pages/badges/coverage.svg" alt="Coverage"></a>
  <a href="https://pkg.go.dev/github.com/shotah/flights-search-mcp"><img src="https://pkg.go.dev/badge/github.com/shotah/flights-search-mcp.svg" alt="Go Reference"></a>
  <img src="https://img.shields.io/github/go-mod/go-version/shotah/flights-search-mcp" alt="Go version">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shotah/flights-search-mcp" alt="License"></a>
</p>

Static Go [MCP](https://modelcontextprotocol.io) for **Google Flights price search
and recommendations** via [SerpAPI](https://serpapi.com/google-flights-api).

Built for [ai-gantry](https://github.com/shotah/ai-gantry) / LOCAL_AGENT: lean
tool surface (7), stdio only, `CGO_ENABLED=0` binary that fits distroless.
**Search + recommend + real checkout handoff — never purchases tickets.**

Naming follows
[ai-gantry MCP tool naming](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md):
host server id `flights` → tools like `flights__offers_search` (tool names do
**not** repeat the server id).

## Tools

| Tool | Description |
| --- | --- |
| `offers_search` | Fixed-date search + summaries + `price_insights` (incl. `price_history`) + tokens |
| `dates_search` | Date-window samples (≤7 calls); `stay_nights` or `stay_nights_min`/`max` (e.g. 4–7) |
| `airports_search` | City/airport → IATA / Google location id |
| `returns_search` | Round-trip: `departure_token` → return offers with `booking_token` |
| `booking_options_get` | **Real checkout** — `booking_token` → airline/OTA options + `booking.url` / `post_data` |
| `link_format` | Fallback Google Flights *search* URL only (no API call) |
| `account_get` | SerpAPI searches used / left + plan renewal (free; does not burn quota) |

Search tools attach a `usage` snapshot (`searches_used`, `searches_left`,
`searches_per_month`, `plan_renewal_date`).

Host names: `flights__offers_search`, `flights__dates_search`,
`flights__airports_search`, `flights__returns_search`,
`flights__booking_options_get`, `flights__link_format`, `flights__account_get`.

### Agent contract (how Tim should call this)

```text
airports_search → dates_search → offers_search → [returns_search] → booking_options_get
```

1. **City → code:** `airports_search` (“Taipei” → `TPE`)
2. **Sweet spots:** `dates_search` with `stay_nights_min=4`, `stay_nights_max=7` (≤7 SerpAPI calls)
3. **Lock itinerary:** `offers_search` on a winner (read `price_history` / price level)
4. **Checkout:**
   - **One-way:** `booking_options_get` with `booking_token` from the offer
   - **Round-trip:** `returns_search` with `departure_token`, then `booking_options_get` with the return’s `booking_token`
5. **Buy handoff:** present `options[].booking` — if `post_data` is set, the host/UI must
   **POST** `booking.url` with that body unchanged; otherwise **GET** the URL.
   Never invent `#flt=` hash links (Google ignores them). `link_format` /
   `google_flights_url` are **search** fallbacks only (`?q=Flights from …`), not checkout.

Does **not** complete a purchase. Free tier ~250 SerpAPI searches/month — booking hops
and date samples each cost a call; check `usage` or `account_get`.

### Gov / contract travel recipe

For economy cabin + preferred airline family + Fly America–aware picks + refundable checkout:

```text
offers_search(
  travel_class=economy,                 # default
  include_airlines=alaska_partners,     # or delta_partners / AS,ONEWORLD / DL,SKYTEAM
  fly_america=annotate,                 # or filter to drop likely_foreign
  funding=civilian                      # or dod (Open Skies hint differs)
)
→ booking_options_get(refundable_only=true)
```

Notes for Tim:

- **Cabin ≠ refundable.** `travel_class=economy` is cabin; refundability is only
  labeled on `booking_options_get` (`refundable=yes|no|unknown` from Google text).
- `exclude_basic` skips basic economy (US domestic + economy only) — still not refundable.
- `fly_america` is a **marketing-designator heuristic**, not legal certification.
  Confirm the ticket shows a US carrier designator (or a documented exception).

## Setup

1. Create a [SerpAPI](https://serpapi.com/) account (250 free searches/month).
2. Export the key:

```bash
export SERPAPI_API_KEY=...
# optional (tests / proxies):
# export SERPAPI_BASE_URL=https://serpapi.com
```

## Development

```bash
make help                 # list targets
make tools                # install goimports-reviser + golangci-lint v2
make install-hooks        # git pre-commit: autofix + lint + test + coverage
make check                # same checks as the pre-commit hook
make cli                  # static binary → ./bin/flights-search-mcp
make self-test
```

## Releasing

GoReleaser publishes static binaries on `v*` tags (see `.github/workflows/release.yml`).

```bash
make version                 # show VERSION + next patch (dry-run)
make release                 # patch bump, commit VERSION, tag, push
make release BUMP=minor
make release TAG=v0.1.0
```

Archive name for ai-gantry `download_url`:

```text
flights-search-mcp_{version}_{os}_{arch}.tar.gz
```

## Run as MCP (stdio)

```bash
./bin/flights-search-mcp
```

Logs go to **stderr** only — stdout is reserved for the MCP protocol.

Example Cursor / client config:

```json
{
  "mcpServers": {
    "flights": {
      "command": "flights-search-mcp",
      "env": {
        "SERPAPI_API_KEY": "…"
      }
    }
  }
}
```

## ai-gantry wiring

```toml
[[server]]
name = "flights"
command = "flights-search-mcp"
download_tag = "latest"
download_url = "https://github.com/shotah/flights-search-mcp/releases/download/{tag}/flights-search-mcp_{version}_{os}_{arch}.tar.gz"
```

## License

MIT

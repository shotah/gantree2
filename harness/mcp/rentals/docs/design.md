# Design — rentals-search-mcp

## Goal

Help friends (and Tim) search **US residential listings** — long-term rentals
**or** homes for sale — through ai-gantry / LOCAL_AGENT with a small, name-stable
MCP surface.

Sibling of [`flights-search-mcp`](../../flights-search-mcp): same packaging
vibes (static Go, stdio MCP, SerpAPI-style lean tools), different upstream.

## Why RentCast

| Option | Fit | Notes |
| --- | --- | --- |
| **RentCast** | Best default for MVP | Official long-term rental + sale listings + rent AVM + zip markets; simple `X-Api-Key` |
| SerpAPI Google Hotels | Wrong inventory | Vacation / hotel stays with check-in/out — not month-to-month leases |
| Zillow / Apartments.com official APIs | Restricted | Partner programs; not a clean public key for a personal MCP |
| RapidAPI scrapers | Fragile | TOS / breakage risk |

RentCast free Developer plan: **~50 requests/month** — agents must be thrifty
(`listings_search` with tight filters; avoid paging the world).

Docs:

- [Rental listings](https://developers.rentcast.io/reference/rental-listings-long-term)
- [Rental listing by id](https://developers.rentcast.io/reference/rental-listing-long-term-by-id)
- [Sale listings](https://developers.rentcast.io/reference/sale-listings)
- [Sale listing by id](https://developers.rentcast.io/reference/sale-listing-by-id)
- [Rent estimate](https://developers.rentcast.io/reference/rent-estimate-long-term)
- [Market statistics](https://developers.rentcast.io/reference/market-statistics)
- [Property types](https://developers.rentcast.io/reference/property-types)

## Host naming

| Layer | Value |
| --- | --- |
| Folder / binary | `rentals-search-mcp` |
| Host `mcp.toml` `name` | `rentals` |
| Tools | `listings_search`, `listings_get`, … |
| Host-facing | `rentals__listings_search` |

Never register `rentals_listings_search` (double prefix).

Canonical rules:
[ai-gantry docs/mcp-naming.md](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md).

## Tool surface (MVP)

### `listings_search`

Maps to `GET /listings/rental/long-term` (`intent=rent`) or `GET /listings/sale`
(`intent=buy`).

Agent-facing args (snake_case):

| Arg | RentCast | Notes |
| --- | --- | --- |
| `intent` | (path) | Defaults to **rent** → `GET /listings/rental/long-term`. Pass `buy` for `GET /listings/sale`. |
| `city` / `state` | `city` / `state` | Case-sensitive on their side — normalize carefully |
| `zip_code` | `zipCode` | Prefer when human gives a zip |
| `zip_codes` | (client filter) | CSV/pipe multi-zip; one API call + filter when city/state set |
| `neighborhood` | lat/lng or zips | Local presets (`areas_resolve`); Seattle first |
| `address` | `address` | Full address; optional with `radius` |
| `latitude` / `longitude` / `radius` | same | Radius miles, max 100 |
| `property_type` | `propertyType` | Alias map below; comma/pipe list (`house,condo`) is **one** call |
| `bedrooms` / `bathrooms` | same | `0` = studio; support `min:max` ranges |
| `square_footage` | `squareFootage` | Ranges ok |
| `price` / `price_min` / `price_max` | `price` | Monthly rent when `intent=rent`; purchase price when `intent=buy` |
| `new_this_week` / `days_old_max` / `days_old` | `daysOld` | Fresh listings (≤7 days shorthand) |
| `pets_wanted` / `parking_wanted` / `laundry_wanted` | — | Soft notes only; RentCast has no amenity filters |
| `status` | `status` | Default `Active` |
| `limit` / `offset` | same | Default `limit=10` for agents (cap ≤50) |

### `areas_resolve`

Local only (no API). Maps neighborhood names/aliases → zips + optional lat/lng.
Start with Seattle; add metros as friends hunt elsewhere.

Property-type aliases (MCP → RentCast):

| Alias | RentCast `propertyType` |
| --- | --- |
| `apartment` / `apartments` | `Apartment` |
| `house` / `home` / `single_family` | `Single Family` |
| `condo` | `Condo` |
| `townhouse` / `townhome` | `Townhouse` |
| `manufactured` / `mobile` | `Manufactured` |
| `multi_family` / `duplex` | `Multi-Family` |
| `land` / `lot` | `Land` (sale listings) |

Response shape (lean):

- `listings[]` — id, `intent`, address, price, beds/baths, sqft, property_type, status,
  days-ish fields, `mls_name` / `mls_number`, `agent` / `office`, `search_url` (Google fallback)
- `summary` — short recommendation blurb for the agent
- `count` / pagination hints
- `query` echo (debuggable)

### `listings_get`

`GET /listings/rental/long-term/{id}` or `GET /listings/sale/{id}` — same
`intent` as search (sale and rental ids are different catalogs).

### `rent_estimate_get`

`GET /avm/rent/long-term` — subject address (+ optional beds/baths/sqft).
Useful when a friend asks “is $X fair for this place?”

### `markets_get`

Zip-level aggregates — “what does Capitol Hill rent look like?” via zip(s).

### `link_format`

No API. Build a public search URL (Zillow `for_rent` or `for_sale` from
`intent`) as a **fallback** when quota is tight or the human wants to click around.

### `account_get`

RentCast does not expose a SerpAPI-style account JSON. We keep a **local**
counter of successful HTTP calls (calendar month, default quota 50) and return:

- `usage.requests_used` / `requests_left` / `period_resets`
- free tier note + dashboard URL
- reminder that official billing period may differ — verify on the dashboard

`link_format`, `areas_resolve`, and `account_get` do not burn RentCast requests.
Search tools attach the same `usage` snapshot on their responses.

**Enforcement:** `getJSON` calls `UsageTracker.Gate` **before** HTTP.

- Soft cap (default 40): billed tools return an error unless `confirm_spend=true`.
  That flag is a per-call bump, not a lock-file reset — the last 10 each need it.
- Hard cap (default 50): billed tools are blocked. The model cannot unlock this.
  A human who upgraded RentCast sets `RENTCAST_ALLOW_OVERAGE=1` in MCP env.
- `RENTCAST_USAGE_TRACK=0` disables the counter and both caps.

## Package layout

```text
rentals-search-mcp/
  cmd/rentals-search-mcp/   # stdio entry (--version, --self-test)
  cmd/release/              # local tag helper (do not push until personal remote)
  internal/mcp/             # tool registration + handlers
  internal/rentcast/        # HTTP client
  docs/                     # design, commercial, ai-gantry wiring
```

## Non-goals for MVP

- Short-term stays
- Commercial retail / office
- Sale AVM / sale market stats (rental `markets_get` / `rent_estimate_get` only)
- Mutations (apply, offer, email, SMS)
- GitHub / release automation until a **personal** remote exists

## Commercial digression

Answered in [commercial-spaces.md](commercial-spaces.md): similar *filter shape*
(location, size, price), different endpoints and vendors → **separate package**.

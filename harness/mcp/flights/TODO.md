# TODO — flights-search-mcp

## MVP + v1.5 — usable with real checkout

Lean stdio MCP: search + recommend + checkout handoff. Matches README tool surface.

| Tool | Host after | Notes |
| --- | --- | --- |
| `offers_search` | `flights__offers_search` | Summaries + price_insights/history + tokens |
| `dates_search` | `flights__dates_search` | Window samples; `stay_nights` or min/max stay range |
| `airports_search` | `flights__airports_search` | City/airport → IATA / Google location id |
| `returns_search` | `flights__returns_search` | `departure_token` → return offers + `booking_token` |
| `booking_options_get` | `flights__booking_options_get` | Real checkout options (`booking.url` / `post_data`) |
| `link_format` | `flights__link_format` | Fallback search URL only |
| `account_get` | `flights__account_get` | Quota used/left + plan renewal |

Search tools embed `usage` after each call (soft-fail if account lookup fails).

Checklist:

- [x] `{service}_{verb}_{object}` names; no `flights_` tool prefix
  ([ai-gantry mcp-naming](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md))
- [x] Name assertion tests
- [x] README + ai-gantry consumer wiring docs
- [x] CI, coverage gate (≥70%), coverage badge → `gh-pages`
- [x] Pre-commit (`make install-hooks`) + GoReleaser on `v*` tags
- [x] Round-trip `dates_search` via `stay_nights` + stay min/max range sweeps
- [x] Per-offer `summary` + smarter recommendations
- [x] SerpAPI usage on responses + `account_get`
- [x] **Real checkout** — `returns_search` + `booking_options_get`
- [x] `price_insights.price_history` on offers
- [x] Agent contract docs (workflow + POST checkout note)

**Buy path:** `booking_options_get` → `options[].booking` (POST when `post_data` set).
`google_flights_url` / `link_format` are fallbacks only. We do not redeem purchases.

---

## Not in this release (for now)

| Item | Notes |
| --- | --- |
| Ticket purchase / completing checkout | Handoff only — host/human finishes buy. |
| Price-tracking / watch DB *inside this MCP* | See open question below. Default: stay stateless. |
| True SerpAPI date-grid / price-graph matrix | Still sampler-based; revisit if SerpAPI adds a cheap calendar API. |
| Multi-city itineraries | Deferred to **v2**. |
| Carbon- / schedule-first ranking | Deferred to **v2** (CO₂ already on offers). |

### Open question — state & memory

Do we need *any* flights-specific persistence, or is **chat summary + the agent’s SQL
memory** enough?

Bias today: **probably enough — don’t build watches/history into this binary until
something real breaks.** Fresh search when checking fares (no offer-payload cache).

---

## v1.6 — gov / contract travel (friend ask)

Real-world ask from someone on **government-funded** travel: filter by preferred
airline families, respect **Fly America Act** rules, economy + refundable checkout.

### What “Fly America Act” means

US law ([GSA overview](https://www.gsa.gov/policy-regulations/policy/travel-management-policy-overview/fly-america-act),
49 U.S.C. § 40118): if the **US government pays** for international air travel
(federal employee, contractor, grant, etc.), you generally must use a **US-flag
carrier** — or a codeshare **ticketed under the US carrier’s designator + flight
number** (e.g. marketed as `DL 123` even if a foreign partner operates the metal).

Important nuances Tim must not oversimplify:

- Booking the **same plane** under a foreign partner’s code usually does **not** comply.
- **Open Skies** exceptions exist for some EU / Switzerland / Australia / Japan travel,
  but **DoD-funded** travel typically cannot use those Open Skies exceptions.
- Other exceptions (schedule hardship, etc.) need human documentation — MCP can
  *flag* candidates, not certify compliance.

### Partner / alliance filter (SerpAPI)

SerpAPI `include_airlines` / `exclude_airlines` accept IATA codes **and** alliances:
`STAR_ALLIANCE`, `SKYTEAM`, `ONEWORLD`.

Presets:

- **Alaska family:** `alaska_partners` → `AS,ONEWORLD`
- **Delta family:** `delta_partners` → `DL,SKYTEAM`

### Fare class vs refundable

- **Cabin / travel class** — `travel_class=economy` (default).
- **Refundable fare** — not a search filter; use `booking_options_get` with
  `refundable_only=true` (parses Google option text; never invents refundability).
- `exclude_basic` skips basic economy (US domestic + economy only) — **≠** refundable.

### In scope for v1.6

- [x] **`include_airlines` / `exclude_airlines`** on `offers_search` + `dates_search`
- [x] **Convenience presets:** `alaska_partners`, `delta_partners` (+ short aliases)
- [x] **`exclude_basic`** on `offers_search` (document SerpAPI limits)
- [x] **Refundable fare filter/annotate** on `booking_options_get`
      (`refundable` + `refundable_only`; prefer refundable in recommendation)
- [x] **`fly_america=annotate|filter`** + `funding=civilian|dod`
      (`fly_america_status`, `compliance_note`, `open_skies_hint`)
- [x] **Agent docs** — gov-travel recipe in README

---

## v2 plan

Goal: power-user itineraries and greener picks — after real usage of checkout.

- [ ] **Multi-city** — ordered legs if SerpAPI path is clean; fail closed if unsupported
- [ ] **Carbon-aware ranking** — prefer / filter / sort by emissions
- [ ] Native date-grid / price-graph if SerpAPI (or alternate) exposes one cheaply
- [ ] Deep-search toggles / cabin mix comparisons
- [ ] Schedule-first ranking modes
- [ ] Stronger Fly America: operated-by vs marketed-by when SerpAPI exposes both;
      City Pair fare awareness (out of scope until we have a data source)

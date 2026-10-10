# TODO — rentals-search-mcp

## Status

- [x] Local sibling folder (no `git init`, no GitHub repo, no push)
- [x] Product docs (README + design + commercial-spaces)
- [x] Compileable MCP stub + naming tests
- [x] Real RentCast HTTP client
- [x] Tool handlers wired to live endpoints
- [x] Coverage ≥70% on client + tools (local + CI gate)
- [x] CI / GoReleaser / README badges / `make release` scaffolding
- [x] Pre-commit hook script (`scripts/pre-commit` → `make install-hooks`)
- [x] Agent docs / TOOLS.md sketch in-repo ([docs/agent.md](docs/agent.md))
- [ ] ai-gantry `mcp.toml` + `local-agent/docs/rentals.md` consumer PR

---

## MVP — usable for friends hunting apartments / houses

Lean stdio MCP: search + recommend + listing handoff. Matches README tool surface.

| Tool | Host after | RentCast source |
| --- | --- | --- |
| `listings_search` | `rentals__listings_search` | `GET /listings/rental/long-term` or `GET /listings/sale` (`intent`) |
| `listings_get` | `rentals__listings_get` | `GET /listings/rental/long-term/{id}` or `GET /listings/sale/{id}` |
| `rent_estimate_get` | `rentals__rent_estimate_get` | `GET /avm/rent/long-term` |
| `markets_get` | `rentals__markets_get` | `GET /markets` (zip stats) |
| `link_format` | `rentals__link_format` | local URL builder (no API) |
| `account_get` | `rentals__account_get` | local usage counter + dashboard (no public quota API) |

Checklist:

- [x] `{service}_{verb}_{object}` names; no `rentals_` tool prefix
  ([ai-gantry mcp-naming](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md))
- [x] Name assertion tests (stub)
- [x] README + design docs
- [x] Implement `internal/rentcast` client (`X-Api-Key` header)
- [x] Summaries + ranked recommendations on `listings_search`
- [x] Pagination (`limit` / `offset`) with a small default page size for agents
- [x] Property-type aliases (`apartment` → `Apartment`, `house` → `Single Family`, …)
- [x] Snake_case MCP args → RentCast query params
- [x] Self-test covers schema + dry client path

**Handoff path:** present `agent` / `office` contact fields from the listing record.
We do not apply, message landlords, or schedule tours.

---

## Not in this package

| Item | Notes |
| --- | --- |
| Short-term / vacation rentals | Different inventory (Google Hotels / Airbnb). Separate MCP if needed. |
| Retail / office / industrial leases | RentCast explicitly excludes these. See [docs/commercial-spaces.md](docs/commercial-spaces.md). |
| Sale AVM / sale market stats | Search/get/link cover buy inventory; rental `markets_get` / `rent_estimate_get` only. |
| Application / credit / tenant screening | Never. |
| In-MCP watch DB | Stay stateless; agent memory + fresh search. |

### Open question — state & memory

Same bias as flights: **chat summary + agent SQL memory** is probably enough.
Don’t build watches into this binary until something real breaks.

---

## Publishing (manual, personal account only)

When *you* are ready:

1. `cd c:\workspace\rentals-search-mcp`
2. `git init` (local only)
3. `make tools && make install-hooks` (coverage ≥70% on every commit)
4. Create a repo under your **personal** GitHub user/org (`gh repo create` from
   an authenticated personal account — **not** work).
5. Add remote, push — CI + coverage badge + GoReleaser are already in-tree.
6. First release: `make release` (or `make release TAG=v0.0.1`).
7. Wire ai-gantry consumer docs in a separate PR.

Until then: develop and test entirely on disk (`make check`).

---

## v2 ideas (after real apartment-hunt usage)

- [x] Days-on-market / “new this week” helpers (`new_this_week`, `days_old_max` → RentCast `daysOld`)
- [x] Multi-zip or neighborhood presets (`areas_resolve` + `neighborhood` / `zip_codes`; Seattle first)
- [x] Pet / parking / laundry — **not** in RentCast API; soft `*_wanted` notes + `link_format` pets hint
- [x] Sale listings via required `intent=rent|buy` on search/get/link (same tools)
- [ ] Sibling **commercial** MCP once a data source is chosen
- [ ] More metro neighborhood presets beyond Seattle — demand-driven (friends first; expand if others actually use it)

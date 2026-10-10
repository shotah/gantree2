# feeds-mcp — finish this package

Open this folder in Cursor and finish here. **Do not `git init` / `gh` — the human will create the repo and push.**

Sibling example: `/home/christopher/google-mcp` (stdio MCP, Makefile, GoReleaser, CI, golangci).
Host contract: `/home/christopher/ai-gantry` — especially [docs/mcp-naming.md](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md) and `internal/watch` (poller parses `{"items":[...]}`).

This is **not** a long-running poller. Stdio request/response only. The gantry kernel ticks and calls `feeds__items_list`.

---

## Naming (locked)

Canonical: ai-gantry `docs/mcp-naming.md`.

| Layer | Value |
| --- | --- |
| Server id (`mcp.toml` `name`, `server.ServerName`) | `feeds` |
| Binary / module | `feeds-mcp` / `github.com/shotah/feeds-mcp` |
| List items | `items_list` → host `feeds__items_list` |
| Find a feed URL | `source_resolve` → host `feeds__source_resolve` |

Rules that bit the first draft:

- `{service}_{verb}_{object}` — **not** verb-first, **not** invented verbs (`fetch` is a synonym for `list`).
- Do **not** put the server id on the tool (`feeds_list_…` → `feeds__feeds_list_…`).
- Stable verbs: `list` / `get` / `search` / `create` / `update` / `delete` / `format`. `resolve` is already used (`rentals__areas_resolve`).
- Tests: every name matches `^[a-z]+_[a-z]+` and does **not** start with `feeds`.
- Descriptions lead with agent intent. Args snake_case. Teach-in errors (`Next: items_list(url="…")`).
- No dual aliases.

Watch row: `tool = "feeds__items_list"` `args = { url = "…" }`. No auth.

X/Twitter is a **different** binary (`twitter-mcp`, later). Do not scrape.

---

## Already on disk

| Path | Status |
| --- | --- |
| `server/server.go` | MCP server name `feeds` |
| `main.go` | stdio only (`mark3labs/mcp-go`) |
| `tools/http.go` | size-capped GET, `FEEDS_USER_AGENT` (NWS requires a UA) |
| `tools/fetch.go` | `items_list` — gofeed RSS/Atom/JSON Feed → `{items:[{id,title,url,summary}]}` |
| `tools/resolve.go` | `source_resolve` — HTML `<link rel=alternate>`, GitHub `releases.atom`, NWS zone `CAZ513`, YouTube channel |
| `LICENSE` / `VERSION` / `.gitignore` | MIT shotah 2026, `v0.1.0` |
| `go.mod` | module path only — **no tidy yet** |

`go.sum` does not exist. First command in this folder: `go mod tidy` (needs `mcp-go`, `gofeed`, `golang.org/x/net`).

---

## Still to do

- [x] `go mod tidy` (Go 1.26, `CGO_ENABLED=0`)
- [x] Tests with `httptest` (no live network): RSS, Atom, JSON Feed, HTML-is-not-a-feed, id fallback (guid → url), limit, `source_resolve` link tags / GitHub / NWS / well-known `/rss.xml`, name-lock test
- [x] Coverage should stay high — same bar as google-mcp / gantry watch
- [x] Copy scaffolding from google-mcp and rename: `Makefile`, `.golangci.yml` (drop Google-only exclusions), `.goreleaser.yaml`, `.github/workflows/ci.yml` + `release.yml`, `scripts/pre-commit`, `scripts/coverage-badge.sh`
- [x] Makefile: no `git init`. `VERSION` file is fine; `git describe` fallback is ok for later
- [x] `cmd/release` + `make release` / `make version` (same as google-mcp / gantry)
- [x] `README.md` — lean: two tools, no auth, gantry `mcp.toml` snippet (`name = "feeds"`), NWS User-Agent, link mcp-naming
- [x] `AGENTS.md` — short naming reminder + link to this TODO
- [x] `golangci-lint run ./...` and `go test ./...` green
- [x] Do **not** wire `mcp.toml` into ai-gantry yet (that is gantry step 4)

---

## Watch JSON contract

`items_list` must return JSON text the kernel already parses (`internal/watch/items.go`):

```json
{"items":[{"id":"…","title":"…","url":"…","summary":"…"}]}
```

Id = guid, else url. Drop rows with no id. Default limit 25, max 50. First watch poll seeds the cursor — do not invent kernel changes here.

---

## Out of scope

- Polling / webhooks / Push
- Twitter / Nitter
- Auth
- Documenting live-agent enablement in this repo

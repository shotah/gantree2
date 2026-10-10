# feeds-mcp

<p align="center">
  <img src="assets/banner.svg" alt="feeds-mcp — two tools, no auth, stdio" width="100%">
</p>

RSS / Atom / JSON Feed MCP server (Go)

<p align="center">
  <a href="https://github.com/shotah/feeds-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/feeds-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shotah/feeds-mcp/actions/workflows/release.yml"><img src="https://github.com/shotah/feeds-mcp/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/shotah/feeds-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/feeds-mcp/raw/gh-pages/badges/coverage.svg" alt="Coverage"></a>
  <a href="https://pkg.go.dev/github.com/shotah/feeds-mcp"><img src="https://pkg.go.dev/badge/github.com/shotah/feeds-mcp.svg" alt="Go Reference"></a>
  <img src="https://img.shields.io/github/go-mod/go-version/shotah/feeds-mcp" alt="Go version">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shotah/feeds-mcp" alt="License"></a>
</p>

**Two tools · no auth · stdio only.** The host (ai-gantry) ticks watches and calls `feeds__items_list`. This binary is request/response — not a poller.

Naming contract: [ai-gantry `docs/mcp-naming.md`](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md).

## Tools

| Tool | Host name | What it does |
| --- | --- | --- |
| `items_list` | `feeds__items_list` | List items from an RSS, Atom, or JSON Feed URL |
| `source_resolve` | `feeds__source_resolve` | Find a feed URL from a page, GitHub repo, NWS zone, or YouTube channel |

Watch row: `tool = "feeds__items_list"` `args = { url = "…" }`.

`items_list` returns JSON the kernel already parses:

```json
{"items":[{"id":"…","title":"…","url":"…","summary":"…"}]}
```

Id is guid, else url. Rows with no id are dropped. Default limit 25, max 50.

X/Twitter is a different binary (`twitter-mcp`). This server does not scrape.

## Install

**Pre-built binary** — grab the archive for your platform from [Releases](https://github.com/shotah/feeds-mcp/releases):

```bash
tar xzf feeds-mcp_*_linux_amd64.tar.gz
chmod +x feeds-mcp
mv feeds-mcp ~/.local/bin/
```

**Or with Go** (1.26+):

```bash
go install github.com/shotah/feeds-mcp@latest
```

## Gantry `mcp.toml`

Server id must be **`feeds`** so hosts expose `feeds__items_list` (do not put `feeds` on the tool name).

```toml
[[server]]
name = "feeds"
command = "feeds-mcp"
download_tag = "latest"
download_url = "https://github.com/shotah/feeds-mcp/releases/download/{tag}/feeds-mcp_{version}_{os}_{arch}.tar.gz"
```

No `args`, no `auth_args`, no env secrets. Optional: `FEEDS_USER_AGENT` (see below).

## NWS User-Agent

[api.weather.gov](https://www.weather.gov/documentation/services-web-api) requires a User-Agent. Default:

```text
feeds-mcp/0.1 (+https://github.com/shotah/feeds-mcp)
```

Override with `FEEDS_USER_AGENT` if NWS asks for contact info:

```bash
export FEEDS_USER_AGENT="feeds-mcp/0.1 (you@example.com)"
```

`source_resolve(query="CAZ513")` returns the NWS zone Atom URL; `items_list` fetches it.

## Development

```bash
make test
make lint
make coverage
make cli
make version          # dry-run: current tag → next patch
make release          # bump VERSION, tag v* + latest, push (BUMP=patch|minor|major)
```

Tests use `httptest` only — no live network.

## License

[MIT](LICENSE)

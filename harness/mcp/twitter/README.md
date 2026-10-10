# twitter-mcp

<p align="center">
  <img src="assets/banner.svg" alt="twitter-mcp — public X posts for the watch cursor" width="100%">
</p>

Stdio MCP server that lists public X/Twitter posts for [ai-gantry](https://github.com/shotah/ai-gantry) watches.

This is **not** a poller. The kernel ticks and calls `twitter__posts_list`. Official X API v2 only — no scrape, no Nitter, no fake RSS.

## Tool

| MCP tool | Host name | What it does |
| --- | --- | --- |
| `posts_list` | `twitter__posts_list` | Resolve `@handle` → user id, then list recent public posts |

Returns watch JSON the kernel already parses:

```json
{"items":[{"id":"123","title":"tweet text","url":"https://x.com/foo/status/123","summary":"tweet text"}]}
```

Args: `handle` (required; leading `@` stripped), `limit` (optional, default 25, max 50).

Naming: [ai-gantry `docs/mcp-naming.md`](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md). Do not put `twitter` on the tool name.

## Auth

App-only **Bearer** on this process. The kernel never sees it.

```bash
export X_BEARER_TOKEN="…"   # developer.x.com → app → Bearer Token
```

Not in v1: user OAuth, home timeline, protected accounts, DMs, posting, `/auth x`.

## Pay-per-use

X API reads are billed even when nobody posted. Prefer a **30–60 minute** watch interval. One-off “what did @foo just say?” can stay web search.

## Install

**Go 1.26+:**

```bash
go install github.com/shotah/twitter-mcp@latest
```

Or grab a release binary and put it on `PATH`.

## gantry `mcp.toml`

```toml
[[server]]
name = "twitter"
command = "twitter-mcp"
env = ["X_BEARER_TOKEN"]
download_tag = "latest"
download_url = "https://github.com/shotah/twitter-mcp/releases/download/{tag}/twitter-mcp_{version}_{os}_{arch}.tar.gz"
```

Watch row: `tool = "twitter__posts_list"` `args = { handle = "foo" }`.

## Dev

```bash
make tidy
make test
make lint
make release          # patch bump + VERSION + tags + push (BUMP=minor|major or TAG=v0.2.0)
```

`CGO_ENABLED=0`. Tests use `httptest` — no live X calls.

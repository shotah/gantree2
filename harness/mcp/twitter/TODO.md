# twitter-mcp — finish this package

Open this folder in Cursor and finish here. **Do not `git init` / `gh` — the human will create the repo and push.**

Sibling example: `/home/christopher/google-mcp` (stdio MCP, Makefile, GoReleaser, CI, golangci).
Parallel sibling: `/home/christopher/feeds-mcp` (same watch item JSON; no auth; copy scaffolding from there once it lands).
Host contract: `/home/christopher/ai-gantry` — [docs/mcp-naming.md](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md) and `internal/watch` (poller parses `{"items":[...]}`).

This is **not** a long-running poller. Stdio request/response only. The gantry kernel ticks and calls `twitter__posts_list`.

---

## Naming (locked)

Canonical: ai-gantry `docs/mcp-naming.md`.

| Layer | Value |
| --- | --- |
| Server id (`mcp.toml` `name`) | `twitter` |
| Binary / module | `twitter-mcp` / `github.com/shotah/twitter-mcp` |
| List public posts | `posts_list` → host `twitter__posts_list` |

Rules:

- `{service}_{verb}_{object}` — **not** `user_posts_list` (verb in the wrong place) and **not** `twitter_posts_list` (double prefix → `twitter__twitter_posts_list`).
- Do **not** put the server id on the tool. Tests: `^[a-z]+_[a-z]+` and name does **not** start with `twitter`.
- Stable verb is `list` (collection). One tool — resolve `@handle` → user id **inside** `posts_list`. Do not add `users_get` unless a second daily ask appears.
- Descriptions lead with agent intent. Args snake_case (`handle`). Teach-in errors (`Next: posts_list(handle="foo")`).
- No dual aliases. No `tweets_*` synonym.

Watch row: `tool = "twitter__posts_list"` `args = { handle = "foo" }`.

---

## Product (locked)

Official X API v2 only. **No scrape. No Nitter. No fake RSS.**

| Question | Answer |
| --- | --- |
| Endpoint | `GET /2/users/by/username/:username` then `GET /2/users/:id/tweets` |
| Auth | App-only **Bearer** on this process: `X_BEARER_TOKEN`. Kernel never sees it. Manifest `env = ["X_BEARER_TOKEN"]`. |
| Not in v1 | User OAuth, home timeline, protected accounts, DMs, posting, `/auth x` |
| Cost | Pay-per-use (2026). Suggest poll 30–60m in tool description. |
| On-demand | “What did @foo just say?” can stay web search. This tool is for a **watch** (Push when they post) or an explicit list. |

Same item shape as feeds-mcp so the watch cursor stays dumb:

```json
{"items":[{"id":"123","title":"tweet text","url":"https://x.com/foo/status/123","summary":"tweet text"}]}
```

Id = tweet id (stable). URL = `https://x.com/{handle}/status/{id}`. Drop rows with no id.

---

## Still to do

- [x] `go mod tidy` — Go 1.26, `CGO_ENABLED=0`, `github.com/mark3labs/mcp-go` (same as google-mcp / feeds-mcp). HTTP to `api.x.com` with stdlib; do not invent a fat Twitter SDK unless one is clearly worth it
- [x] `server.ServerName = "twitter"`
- [x] `posts_list(handle, limit?)` — strip leading `@`; lookup user; list tweets; return watch JSON
- [x] Missing `X_BEARER_TOKEN` → teach-in error, not a panic
- [x] Tests with `httptest` (no live X calls): handle lookup, tweet list, 401, missing token, name-lock
- [x] Copy scaffolding from google-mcp (or feeds-mcp if finished): Makefile, `.golangci.yml`, `.goreleaser.yaml`, CI/release workflows, `scripts/pre-commit`, `scripts/coverage-badge.sh`, `LICENSE` (MIT shotah), `VERSION` `v0.1.0`, `.gitignore`
- [x] Makefile: no `git init`. `VERSION` file is fine
- [x] `README.md` — lean: one tool, Bearer env, gantry `mcp.toml` snippet (`name = "twitter"`), pay-per-use warning, link mcp-naming
- [x] `golangci-lint run ./...` and `go test ./...` green
- [ ] Do **not** wire `mcp.toml` into ai-gantry yet (gantry step 4)

---

## Out of scope

- Polling / webhooks / Push (kernel)
- RSS / feeds (that is `feeds-mcp`)
- Scraping, guest tokens, GraphQL
- User OAuth / posting / DMs
- Documenting live-agent enablement in this repo

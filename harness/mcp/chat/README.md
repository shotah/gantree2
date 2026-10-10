# pendant-mcp

<p align="center">
  <img src="assets/banner.svg" alt="pendant-mcp - face, wallpaper, mood over stdio" width="100%">
</p>

Stdio MCP server that lets the crane change what the Pendant mouth looks like: face, chat wallpaper, and a closed mood catalog. Pictures come from `image-generation-mcp` on disk (`IMAGE_OUTPUT_DIR` → `source_path`). This binary POSTs JPEG to the mailbox Worker.

Naming contract: [ai-gantry `docs/mcp-naming.md`](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md). Spec: [gantry-pendant `docs/agent_ui_controls.md`](https://github.com/shotah/gantry-pendant/blob/main/docs/agent_ui_controls.md).

<p align="center">
  <a href="https://github.com/shotah/pendant-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/pendant-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/shotah/pendant-mcp/actions/workflows/release.yml"><img src="https://github.com/shotah/pendant-mcp/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/shotah/pendant-mcp/actions/workflows/ci.yml"><img src="https://github.com/shotah/pendant-mcp/raw/gh-pages/badges/coverage.svg" alt="Coverage"></a>
  <a href="https://pkg.go.dev/github.com/shotah/pendant-mcp"><img src="https://pkg.go.dev/badge/github.com/shotah/pendant-mcp.svg" alt="Go Reference"></a>
  <img src="https://img.shields.io/github/go-mod/go-version/shotah/pendant-mcp" alt="Go version">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/shotah/pendant-mcp" alt="License"></a>
</p>

## Tools

| Tool | Host name | What it does |
| --- | --- | --- |
| `avatar_update` | `chat__avatar_update` | Set Kit's face from a picture on disk → `POST /api/chat/avatar` |
| `avatar_get` | `chat__avatar_get` | Current face as MCP image + `{ rev, bytes }`; writes a file when `IMAGE_OUTPUT_DIR` is set |
| `backdrop_update` | `chat__backdrop_update` | Set the chat wallpaper → `POST /api/chat/backdrop` |
| `backdrop_delete` | `chat__backdrop_delete` | Clear it → `DELETE /api/chat/backdrop` |
| `theme_list` | `chat__theme_list` | `GET /api/chat/theme` — current id plus cards (`id`, `label`, `feel`, `scheme`, `mood`, `canvas`, `accent`) |
| `theme_update` | `chat__theme_update` | `{ theme }` from the catalog → `POST /api/chat/theme` |
| `theme_delete` | `chat__theme_delete` | Clear the room mood → `DELETE /api/chat/theme` |

Picture-tool result: `{ rev, bytes, edge, mime }` (optional `path`). Base64 is **not** in the text. Theme list is the GET body as-is.

Not in v1: `source_url` fetch, raw hex themes, `theme_snapshot`.

## Two-step recipe

1. `image__photo_generate` with `IMAGE_OUTPUT_DIR` set (1:1 portrait for the face, 9:16 for wallpaper).
2. `chat__avatar_update` / `chat__backdrop_update` with that `source_path`.

Mood: `theme_list` → filter `feel` → `theme_update`. Do not invent hex.

`source_path` must resolve **inside** `IMAGE_OUTPUT_DIR` (or `PENDANT_IMAGE_DIR`) after symlinks. `/etc/hostname` is refused.

## Auth

Crane env, inherited by the child. The kernel never sees the bearer.

```bash
export CHAT_MAILBOX_URL="wss://…/ws/kit"   # already on CHANNEL=chat
export CHAT_BEARER="…"
export IMAGE_OUTPUT_DIR="/var/lib/gantry/images"  # required for the picture pair
```

`PENDANT_MAILBOX_URL` and `PENDANT_BEARER` are deprecated aliases, used only when the `CHAT_*` name is unset.

Optional:

| Key | Notes |
| --- | --- |
| `CHAT_API_PREFIX` | HTTP path before the kind. Default `/api/chat`. Set `/api` for the old routes. |
| `PENDANT_IMAGE_DIR` | Second allowed root for `source_path`. |
| `IMAGE_OUTPUT_DIR` | Where `image__photo_generate` writes. Theme tools do not need it. |

Header only: `Authorization: Bearer`. The door refuses `?bearer=`.

## Install

**Pre-built binary** — grab the archive for your platform from [Releases](https://github.com/shotah/pendant-mcp/releases):

```bash
tar xzf pendant-mcp_*_linux_amd64.tar.gz
chmod +x pendant-mcp
mv pendant-mcp ~/.local/bin/
```

**Or with Go** (1.26+):

```bash
go install github.com/shotah/pendant-mcp@latest
```

## Gantry `mcp.toml`

Server id must be **`chat`**. Grant `image` on the same crane and set `IMAGE_OUTPUT_DIR` or the picture pair cannot hand off.

```toml
[[server]]
name = "chat"
command = "chat"
download_tag = "latest"
download_url = "https://github.com/shotah/pendant-mcp/releases/download/{tag}/pendant-mcp_{version}_{os}_{arch}.tar.gz"
# CHAT_MAILBOX_URL + CHAT_BEARER already live in the gantry process env
# PENDANT_MAILBOX_URL + PENDANT_BEARER are deprecated aliases
# IMAGE_OUTPUT_DIR must be set for avatar_update / backdrop_update
```

`mcp_enable` prefix is `chat` (families: `avatar`, `backdrop`, `theme`).

## Development

```bash
make test
make lint
make coverage
make cli
make version          # dry-run: current tag → next patch
make release          # bump VERSION, tag v* + latest, push (BUMP=patch|minor|major)
```

`CGO_ENABLED=0`. Tests stub the Worker HTTP — no live Pendant.

## License

[MIT](LICENSE)

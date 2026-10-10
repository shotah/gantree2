# Agent / contributor notes

## Tool naming (required)

Canonical: [ai-gantry `docs/mcp-naming.md`](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md).

Every MCP tool name is **service-first**:

```text
{service}_{verb}_{object}[_{qualifier}]
```

This server:

| Layer | Value |
| --- | --- |
| Server id (`ServerName`, `mcp.toml` `name`) | `chat` |
| Tools | `avatar_update`, `avatar_get`, `backdrop_update`, `backdrop_delete`, `theme_list`, `theme_update`, `theme_delete` |
| Host-facing | `chat__avatar_update`, … |

Rules:

1. **Service first** — `avatar_update`, not `update_avatar` / `set_face`.
2. **No server id on the tool** — never `chat_avatar_update` (host already prefixes).
3. **Stable verbs** — `get` / `list` / `update` / `delete`. Do not invent `set` / `clear` / `wear`.
4. **No dual aliases.**
5. Tests: every name matches `^[a-z]+_[a-z]+` and does **not** start with `chat` (or the old `pendant` id).

Descriptions lead with agent intent. Args are snake_case (`source_path`, `source_image`, `theme`). Teach-in errors name the next call (`Next: theme_list()`).

## Auth

Crane bearer already in the process env. `CHAT_BEARER` on `Authorization` only — never in a tool result, never `?bearer=`. `PENDANT_BEARER` is a deprecated alias. `bearerForSlug` on the Worker binds the token to one room.

Do not fold this into `image-generation-mcp`. Picture gen stays there; this binary POSTs the file.

## Picture handoff

ai-gantry stringifies MCP results and truncates. The PNG from `image__photo_generate` does not reach the model as bytes. Set `IMAGE_OUTPUT_DIR` on any crane that has both MCPs; `source_path` must resolve inside that dir (or `PENDANT_IMAGE_DIR`) after symlinks.

## Sisters

| What | Path |
| --- | --- |
| Host + naming | ai-gantry `docs/mcp-naming.md` |
| Spec | gantry-pendant `docs/agent_ui_controls.md` |
| Picture gen | `image-generation-mcp` |
| Stdio MCP scaffold | `feeds-mcp` |

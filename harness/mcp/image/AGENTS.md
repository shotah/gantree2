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
| Server id (`ServerName`, `mcp.toml` `name`) | `image` |
| Tools | `photo_generate`, `photo_edit` |
| Host-facing | `image__photo_generate`, `image__photo_edit` |

Rules:

1. **Service first** — `photo_generate`, not `generate_image` / `create_image`.
2. **No server id on the tool** — never `image_generate` (host already prefixes → `image__image_generate`).
3. **Stable verbs** — `generate` / `edit`. Do not invent `render` / `draw` / `imagine`.
4. **No dual aliases.** No `image_*` synonym.
5. Tests: every name matches `^[a-z]+_[a-z]+` and does **not** start with `image`.

Descriptions lead with agent intent. Args are snake_case (`prompt`, `aspect_ratio`, `source_path`, `source_image`). Teach-in errors name the next call (`Next: photo_edit(prompt="…", source_path="…")`).

## Auth

Gemini **API key**, not Workspace OAuth. Do not fold this into `google-mcp`. Default backend is Nano Banana 2 (`gemini-3.1-flash-image`). `IMAGE_PROVIDER` is the swap point.

Same key family as `mcp-gemini-search`: `IMAGE_API_KEY` wins, else crane `LLM_API_KEY`.

## Sisters

| What | Path |
| --- | --- |
| Host + naming | ai-gantry `docs/mcp-naming.md` |
| Stdio MCP scaffold | `feeds-mcp` / `google-maps-mcp` |
| Gemini API key (search, not images) | `mcp-gemini-search` |
| Workspace OAuth (not this binary) | `google-mcp` |
| Pendant face / wallpaper / mood | `pendant-mcp` |

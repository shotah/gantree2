# Agent / contributor notes

## Tool naming (required)

Canonical: [ai-gantry `docs/mcp-naming.md`](https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md).
Package-specific checklist: [TODO.md](TODO.md).

Every MCP tool name is **service-first**:

```text
{service}_{verb}_{object}[_{qualifier}]
```

This server:

| Layer | Value |
| --- | --- |
| Server id (`ServerName`, `mcp.toml` `name`) | `feeds` |
| Tools | `items_list`, `source_resolve` |
| Host-facing | `feeds__items_list`, `feeds__source_resolve` |

Rules:

1. **Service first** — `items_list`, not `list_items` / `fetch_feed`.
2. **No server id on the tool** — never `feeds_list_…` (host already prefixes → `feeds__feeds_list_…`).
3. **Stable verbs** — `list` / `get` / `search` / `create` / `update` / `delete` / `format` / `resolve`. Do not invent `fetch`.
4. **No dual aliases.**
5. Tests: every name matches `^[a-z]+_[a-z]+` and does **not** start with `feeds`.

Descriptions lead with agent intent. Args are snake_case. Teach-in errors name the next call (`Next: items_list(url="…")`).

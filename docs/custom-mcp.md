# Custom plugins

A plugin is a module under `brain/plugins/<name>/` that exports a
`Plugin`: `name`, `ready`, `tools`, and `call` on each tool. It is
compiled into the Worker. Add it to `allPlugins` in
`brain/plugins/index.ts`. There is no process to spawn, no image to
rebuild, and no `/mcp/add?url=` route.

Tool names follow [mcp-naming.md](mcp-naming.md). The host prefixes
`{plugin}__{tool}` (`brain/tools/names.ts`). Plural inputs and list
outputs are `.cursor/rules/brain-plugins-plural.mdc`. A tool that is
inherently one thing sets `single` on its `ToolDef` and says why.

`ready()` returns `null` when the plugin can serve, or a skip:
`no_key`, `no_oauth`, `disabled`, `error`. That list is the `status`
frame. `GARMIN_TOOL_TIER` and `GOOGLE_TOOL_PRESET` narrow those two
catalogs before publish.

Grants from the Tools fold reach the registry directly. A plugin left
off the grant list is not in the catalog. `ready()` still skips a
granted plugin that has no key or no token.

Copy a sibling under `brain/plugins/` rather than starting from an
empty module. `chat` is the room. `math` is the smallest plugin with
no secret. `maps` is one API key. `google` is the OAuth shape
([auth.md](auth.md)).

Tests live under `test/brain/plugins/` and mirror the module.

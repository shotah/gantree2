# pendant-mcp — leftover

Human creates the GitHub repo (`shotah/pendant-mcp`) and pushes this tree. Do not `git init` / `gh` from the agent.

After the empty GitHub repo exists:

1. Push `main` (CI + coverage badge on first push).
2. Tag `v0.0.1` (or `make release` once this folder is its own git remote) so GoReleaser publishes the archives gantry already points at.
3. Actions: allow `GITHUB_TOKEN` write (coverage `gh-pages` + releases).

## Follow-ups (not this binary)

- Worker blob write rate limit (`blob:face` / `blob:backdrop`).

## Done elsewhere

- Yard ingest: gantree `PACKAGES` + `HOST_SHAPE.pendant`.
- ai-gantry: `docs/mcp-naming.md` nouns + host table; example `mcp.toml`; crane socket ignores `face` / `backdrop` / `theme`.
- image-generation-mcp: `photo_edit` accepts `source_path` (same root rule).

## Do not

- Name tools `pendant_*` (double prefix)
- Lead descriptions with `source_image` (ai-gantry truncates image bytes)
- Fetch `source_url` over the network
- Invent hex / dump CSS for theme
- Live Pendant Worker in unit tests
- Log the bearer or the JPEG bytes

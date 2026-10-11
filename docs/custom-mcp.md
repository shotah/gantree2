# Custom MCP servers

On `runtime: native` a plugin is a module under `brain/plugins/<name>/`
that exports a `Plugin`: `name`, `ready`, `tools`, and `call` on each
tool. It is compiled into the Worker. There is no process to spawn and
no image to rebuild. Tool names follow [mcp-naming.md](mcp-naming.md),
and the host prefixes `{plugin}__{tool}`. Plural inputs and list
outputs are `.cursor/rules/brain-plugins-plural.mdc`. `ready()` returns
`no_key`, `no_oauth`, `disabled`, or `error` when the plugin cannot
serve; otherwise `null`. The native registry loads every module in
`brain/plugins/index.ts` and does not read `config.mcp`.

There is still no `/mcp/add?url=` route and no download at agent start.

The rest of this page is the container image: a row in `harness/mcp.lock`
and a rebuild. That is `runtime: container`, kept until cutover.

---

## A. Build one — clone an existing MCP

Do not start from a blank Go module. Fork or copy a sibling that already
speaks stdio, ships a static binary, and prints **shape**. Those siblings
live under `harness/mcp/<name>/` in this repo once Phase 2 lands; until
then they are their own GitHub repos.

| You need | Clone this | Why |
| --- | --- | --- |
| No secrets | `mcp-go-math` | Smallest: evaluate + convert, empty `env_keys` |
| One API key | `google-maps-mcp` | `host-manifest` + `GOOGLE_MAPS_API_KEY` |
| Image gen | `image-generation-mcp` | `IMAGE_API_KEY` or the agent's `LLM_API_KEY`; grant prefix `image` |
| Chat face / mood | `pendant-mcp` | Face, wallpaper, mood → the room theme. Prefix `pendant` (wire name) |
| OAuth hop | `go-strava-mcp` | `auth_args` + PKCE paste (`url` / `exchange`) |

Keep:

- `CGO_ENABLED=0` static binary, stdio MCP only
- Root `package main` so `go run . host-manifest` works
- Tool names `{service}_{verb}_{object}` with **no** server id in the
  tool name
- A `go.mod` at the plugin root. `harness.yml` runs its tests and rolls
  its coverage into the **harness coverage** badge; an untested plugin
  lowers the number for everyone.

Do not reuse `maps`, `math`, `image`, or `pendant`.

### `host-manifest` (required)

The binary must exit 0 and print one JSON object on stdout:

```bash
CGO_ENABLED=0 go run . host-manifest
```

```json
{
  "name": "rentals",
  "command": "rentals-search-mcp",
  "env_keys": ["RENTCAST_API_KEY"],
  "blurb": "US listings. One RentCast key."
}
```

Optional fields: `args`, `auth_args`, `auth_flow` (`pkce` | `device` |
`mfa`), `home_only`. First arg `host-manifest` must not start the stdio
server.

If the tool needs a browser hop, implement the auth argv the harness
already speaks and set `auth_args` (e.g. `["auth"]`). Static keys stay
in the agent's `config.env` — never `/auth rentals <apikey>` in chat.

---

## B. Bake it in (legacy container)

Add a row to `harness/mcp.lock`:

```toml
[[server]]
name = "rentals"
command = "rentals-search-mcp"
path = "mcp/rentals"            # in-repo plugin: built from source in the image
# or, for a server that lives elsewhere:
# repo = "github.com/you/rentals-search-mcp"
# tag  = "v0.3.1"
```

`harness/Dockerfile` builds (or fetches) every row into `/opt/mcp/<id>/<id>`
at **image build** — one binary, not a second copy on `PATH` — and runs
`host-manifest` for each so the shape sits beside it. Inside the image a
bare `command` resolves to that path. Distroless stays distroless. Push to
`main`; `harness-image.yml` publishes the new tag.

Then on `/agents/<slug>`:

1. **pull + recreate** to the new image tag.
2. Tools grid now shows **rentals**. Toggle it — settings writes the
   `[[server]]` into `config.mcp` and the needed keys appear in the
   Secrets fold (from `env_keys`).
3. Put the key in. Env change **recreates**. The agent's `status` frame
   on reconnect lists `rentals` as published, or says why not
   (`no_key` / `no_oauth`).

No GitHub rate limits at agent start, no `/data/bin`, no prune step:
the image is the install.

---

## C. One agent only, no catalog row

You can hand-write a `[[server]]` in one agent's `config.mcp` for a
binary already in the image. It will not appear as a checkbox for
other agents until it has a `mcp.lock` row — but a `mcp.lock` row is
the only way into the image, so in practice every server is in the
catalog. The distinction that remains is `home_only`: servers that
need mDNS or the LAN (`life-cast`) are hidden on Cloudflare and shown
under celld.

# Install — local, Cloudflare, or home

Same Worker, same `wrangler.jsonc`, three places it runs. Agents open
**zero** inbound ports anywhere: the harness dials the Worker.

| Place | Command | State | Reach it at |
| --- | --- | --- | --- |
| Local dev | `npm run dev` | in-memory, `.wrangler/` | `http://127.0.0.1:3000` |
| Cloudflare | `wrangler deploy` (CI) | Workers · DO · KV · R2 · Containers | `https://gantree2.bldhosting.com` (custom domain in `wrangler.jsonc`; a fork edits `routes` or drops it for `workers.dev`) |
| Home (Mini / NUC / VM) | `npm run deploy:home` (`celld deploy`) | celld's SQLite + an S3-compatible bucket you own | Tailscale HTTPS or a Cloudflare Tunnel |

Need **Node 22** (`node -v`). Distro `apt install npm` is often Node 20
and will fail.

---

## Google OAuth client

gantree does not create this. GCP → **APIs & Services → Credentials →
Create credentials → OAuth client ID**.

| Field | Value |
| --- | --- |
| Application type | **Web application** |
| Authorized redirect URIs | one line per place you run, below |
| Scopes (consent screen) | `openid`, `email`, `profile` — nothing else |

| Place | Redirect URI |
| --- | --- |
| Local dev | `http://127.0.0.1:3000/api/auth/callback/google` (Google accepts loopback `http`) |
| Cloudflare | `https://gantree2.bldhosting.com/api/auth/callback/google` (a fork: its own `routes` host or `workers.dev` origin) |
| Home | `https://<mini>.<tailnet>.ts.net/api/auth/callback/google` or your Tunnel hostname |

**Google rejects private LAN IPs** (`http://192.168.x.x`). A home box
must sit behind Tailscale HTTPS or a Tunnel for sign-in to work. One
client can carry all three redirects.

Consent screen: External (or Internal if Workspace-only). External +
Testing → add yourself as a test user.

---

## Local dev

```bash
git clone https://github.com/shotah/gantree2.git
cd gantree2
cp .dev.vars.example .dev.vars
# .dev.vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET (≥32 chars),
#            GANTREE_ADMINS=you@example.com
npm ci
npm run dev            # http://127.0.0.1:3000 → /login
```

Sign in. You are admin. A second Google account gets `not_allowed`
until you add it on `/users`.

Without a Google client: `GANTREE_DEV_USER=118212345678901234567:you@example.com`
in `.dev.vars` fakes a session on loopback only. The sub is 10–32 digits.
It still has to be in `GANTREE_ADMINS` or `GANTREE_ALLOW`. Details:
[access.md](access.md#dev-without-google).

`npm run dev` is Vite on `127.0.0.1:3000`. It serves the Durable Objects.
Containers need Docker, which local dev does not assume: `wrangler.jsonc`
sets `dev.enable_containers` to false, and the agent page shows the
container as unknown instead of failing. Screenshots in this repo were
taken against `npm run dev`. `npm run build && npm run start` is the
built Worker under Miniflare (`dist/server/wrangler.json`); use it when
you want the production bundle, not to get Durable Objects.

### Chat with a real agent locally

No Docker, no deploy. The Worker from `npm run dev` is the room; the Go
harness runs as a plain process on your machine and dials it the same
way the container would.

```bash
# .dev.vars, in addition to the above:
#   GANTREE_DEV_USER=118212345678901234567:you@example.com   # the runner signs in through the dev door
#   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
#   LLM_API_KEY=...
#   LLM_MODEL=gemini-3.8-flash
npm run dev                      # terminal 1
# create an agent at http://127.0.0.1:3000/agents/new — the keys step is
# optional now: blank fields use the house LLM_* from .dev.vars
npm run agent -- kit             # terminal 2 (builds harness/bin/gantry on first run; needs Go)
# open http://127.0.0.1:3000/chat/kit
```

`npm run agent` reads `.dev.vars`, fetches the room bearer
(`GET /api/agents/:slug/bearer`, admin on loopback dev only), adds the
dev user to the room if missing, and supervises `gantry run` with
`CHANNEL=chat SNAPSHOT=true` pointed at `ws://127.0.0.1:3000/ws/<slug>`.
The Agent DO then sends the config frame exactly as in production:
persona, MCP manifest, secrets, and presigned snapshot URLs. Memory,
self-notes, cron, aims, and the snapshot restore/publish loop are the
real ones; state lives in `local/run/<slug>/` (git-ignored) and the
snapshot in the local R2 bucket, so stopping and restarting the runner
restores the brain and, encrypted, the tool logins
([below](#oauth-tokens-in-the-snapshot)). With no slug it runs every agent on the board;
`--build` forces a rebuild; `--base=` points at another origin.

House keys: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, and
`BRAVE_SEARCH_API_KEY` in the Worker env are laid under every agent's
own secrets in the config frame — an agent that sets its own wins. The
browser only ever sees the key names (`GET /api/tools` → `house`). This
is the same in production: set them with `wrangler secret put` and new
agents need no keys of their own.

MCP plugins are found on `PATH`; `harness/bin` is prepended, so drop
binaries there (the catalog in [mcp.md](mcp.md)). Missing plugins are
skipped as `no_binary`, not fatal. The container flavour of the same loop is `celld` below: it runs
the real harness image with Docker or Podman and the same `.dev.vars`.

```bash
npm run seed -- --vars   # writes .dev.vars.shot from .dev.vars (placeholder identity)
npm run dev:shot         # the same dev server, reading .dev.vars.shot
npm run seed             # fills Kit and Ada through the HTTP API
npm run shot             # headless Chrome → assets/docs/*.png. CHROME_BIN overrides the Chrome path.
```

Pictures never carry a real account. `npm run seed` derives
`.dev.vars.shot` (git-ignored) from your `.dev.vars`: every secret is
copied, but `GANTREE_DEV_USER` and `GANTREE_ADMINS` become the
placeholder `100000000000000000001:dev@example.com` and `GANTREE_ALLOW`
is emptied. `npm run dev:shot` is `CLOUDFLARE_ENV=shot`, which makes the
Cloudflare Vite plugin read that file instead of `.dev.vars`; your real
`.dev.vars` stays as it is for the Google walk. Seed refuses to run
against a server signed in as anyone but the placeholder, and tells you
to restart with `dev:shot` whenever it mints bearers. Shots wear the Neon
theme by default; `GANTREE_SHOT_THEME=<id>` picks another. `npm run shot`
opens `/chat` as the dev user. A member picker needs
`GANTREE_SHOT_AS_MEMBER=1` against a server whose `.dev.vars.shot` has
no `GANTREE_DEV_USER` (seed writes the member cookie).

![Sign-in page with Continue with Google](../assets/docs/login.png)

---

## GitHub settings — the whole list

Everything any workflow in `.github/workflows/` reads. Repository →
**Settings → Secrets and variables → Actions**. Variables are plain
text and show in logs; Secrets are masked. This is the only list —
if a workflow grows a new `vars.X` or `secrets.X`, it is added here.

| Kind | Name | Used by | Value | Required |
| --- | --- | --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | `deploy-cloudflare` | API token with Workers Scripts Edit · Workers KV Storage Edit · Workers R2 Storage Edit · Account Settings Read | yes |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | `deploy-cloudflare` | dashboard sidebar | yes |
| Variable | `GOOGLE_CLIENT_ID` | `deploy-cloudflare` | the sign-in client, from GCP | yes |
| Secret | `GOOGLE_CLIENT_SECRET` | `deploy-cloudflare` | same client | yes |
| Secret | `SESSION_SECRET` | `deploy-cloudflare` | `openssl rand -base64 48` (≥ 32 chars) | yes |
| Variable | `GANTREE_ADMINS` | `deploy-cloudflare` | `you@example.com` (grammar: [access.md](access.md#allowlist-entry-grammar)) | yes |
| Variable | `GANTREE_ALLOW` | `deploy-cloudflare` | members, comma list; may be empty | set, may be blank |
| Variable | `VAPID_SUBJECT` | `deploy-cloudflare` | `mailto:you@example.com` | only with push |
| Secret | `VAPID_PUBLIC_KEY` | `deploy-cloudflare` | `npx web-push generate-vapid-keys` | only with push |
| Secret | `VAPID_PRIVATE_KEY` | `deploy-cloudflare` | same pair | only with push |
| Secret | `LLM_BASE_URL` | `eval` | the model the eval drives, e.g. `https://generativelanguage.googleapis.com/v1beta/openai` | eval skips without all three |
| Secret | `LLM_API_KEY` | `eval` | | eval skips without all three |
| Secret | `LLM_MODEL` | `eval` | e.g. `gemini-3.8-flash` | eval skips without all three |
| Variable | `PAGES_CUSTOM_DOMAIN` | `pages` | defaults to `github.bldhosting.com`; a fork sets its own or empties it | no |
| Variable | `GOOGLE_SITE_VERIFICATION` | `pages` | Search Console token for the docs site | no |

`GITHUB_TOKEN` is automatic (`ci`, `harness`, `harness-image`, `pages`,
`release`). The `deploy-cloudflare` job fails fast if any of the four
auth values (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET`, `GANTREE_ADMINS`) is empty.

**Not in GitHub.** The house keys that let a new agent run with no
keys of its own (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`,
`BRAVE_SEARCH_API_KEY`) are Worker secrets, set once from a laptop
with the same Cloudflare token:

```bash
npx wrangler secret put LLM_BASE_URL     # and LLM_API_KEY, LLM_MODEL, BRAVE_SEARCH_API_KEY
```

Never set in production: `GANTREE_DEV_USER` (loopback dev door) and
`CHAT_SECRET` (loopback two-tab spike). `AGENT_BEARERS` is an
override; the Agent DO mints bearers itself.

Outside GitHub and Cloudflare, the remaining owner steps are the
Google client redirect URIs ([above](#google-oauth-client)) and the
tools' provider consoles ([auth.md](auth.md)).

---

## Cloudflare

CI does it, with the GitHub settings [above](#github-settings--the-whole-list).
Push to `main`. `ci.yml` runs tests, lint, typecheck, build.
`deploy-cloudflare.yml` then creates the `DIRECTORY` KV namespace and
the `gantree-store` R2 bucket if they are missing (the `TODO` id in
`wrangler.jsonc` is patched for that run only), runs
`wrangler deploy --var …` and `wrangler secret bulk`. It fails fast if
any of the four auth values is empty. Add the Worker origin to the
Google client's redirect list.

By hand from a laptop (same token in your shell), once:

```bash
npx wrangler kv namespace create DIRECTORY   # paste the id over "TODO" in wrangler.jsonc
npx wrangler r2 bucket create gantree-store
npm run deploy
npx wrangler secret bulk < secrets.json   # {"GOOGLE_CLIENT_SECRET":"…","SESSION_SECRET":"…"}
```

The Worker itself runs on the free tier. Containers need Workers Paid —
see [below](#containers).

---

## Containers

One harness container per agent. The Cloudflare account needs Containers
enabled (Workers Paid). `wrangler deploy` builds `harness/Dockerfile`
(context is the `harness/` directory, which is where that file's
`COPY` expects to run) and ships the image with the Worker.
`wrangler.jsonc` names the application `gantree-harness`, class
`Harness`, five instances, plus a `v2` migration for the `Harness`
Durable Object.

The process env is the dial-back. Everything else (LLM keys, `mcp.toml`,
persona) arrives on the socket in a `config` frame.

| Var | Value |
| --- | --- |
| `CHANNEL` | `pendant` |
| `PENDANT_MAILBOX_URL` | `wss://<origin>/ws/<slug>` — the harness adds `?role=crane` |
| `PENDANT_BEARER` | room bearer from the Agent DO |
| `SNAPSHOT` | `true` |
| `SNAPSHOT_INTERVAL` | `5m` |

Set `PUBLIC_ORIGIN` to `https://<worker-origin>` (no path) when the host
the harness should dial is not the browser's. Leave it unset locally and
start uses the request origin.

The image does not `EXPOSE` a port. The supervisor still sets
`defaultPort` 8080 so the Container class has a probe port; `gantry`
dials out and does not listen.

Local `wrangler dev` without Docker has no container binding. `GET
/api/agents/:slug/container` then returns `state: "unknown"`.

The `gantry` binary in this tree also refuses to stay up without
`PENDANT_ALLOWED_USERS`. The start body does not carry that list — the
room lives on the Agent DO — so a real container exits until the harness
takes the room from the `config` frame.

### OAuth tokens in the snapshot

Refresh tokens for Google Workspace, Strava, Google Health, and Garmin
live under `DATA_DIR` and join the agent snapshot whenever `SNAPSHOT=true`.
That is the same on Cloudflare, on celld, and for `npm run agent`: the
config frame is the only prerequisite. The harness tars an allowlist of
those files, encrypts the tar with AES-256-GCM (a random 12-byte nonce
prefixed to the ciphertext), and PUTs the ciphertext as `tokens_tar`.
The Agent DO mints the 32-byte key once, stores it next to the room
bearer, and sends it on the config frame as `SNAPSHOT_KEY`. The Worker
stores the object and never sees plaintext. If none of the token files
exist, that PUT is skipped; a 404 on GET is a no-op. A missing key skips
the archive and is logged once — plaintext is never uploaded. On celld,
`/data` is also a volume, so the snapshot is a second copy.

---

## Home (celld)

[celld](https://github.com/denoland/celld) runs the Workers platform on
your own box from the same `wrangler.jsonc`: Workers, Durable Objects,
KV, R2, Cron, static assets, and — experimentally — Containers. Install
per its README; it needs Docker or Podman for the harness container
and an S3-compatible bucket (MinIO on the same box is fine) for
durable state. `celld dev` needs neither.

```bash
# on the Mini
cat > /etc/gantree/vars.env <<'EOF'
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
SESSION_SECRET=…
GANTREE_ADMINS=you@example.com
GANTREE_ALLOW=
EOF
chmod 600 /etc/gantree/vars.env

git clone https://github.com/shotah/gantree2.git /opt/gantree
cd /opt/gantree && npm ci
CELLD_VARS_FILE=/etc/gantree/vars.env npm run deploy:home
```

Put a hostname in front:

**Tailscale** (preferred): `tailscale serve --bg https / http://127.0.0.1:<celld-port>`.
Redirect URI is `https://<mini>.<tailnet>.ts.net/api/auth/callback/google`.

**Cloudflare Tunnel** (zone already on Cloudflare, no WAN ports):
`cloudflared tunnel run` with the public hostname → `http://127.0.0.1:<celld-port>`.

Do not open a router or cloud firewall port to the world. celld stops
on any `wrangler.jsonc` key it does not model, so a manifest that
deploys to Cloudflare deploys here, or tells you exactly why not.

Home deploy is **not** a GitHub Action. GitHub cannot reach the Mini
and should not.

---

## Harness image

One image, `harness/Dockerfile`: the Go harness plus every MCP server in
`harness/mcp.lock` baked into `/opt/mcp/<id>/<id>`. Neither deploy
target pulls it from a registry — `wrangler deploy` builds it into the
account's container registry and celld builds it on the box — so
**Recreate** picks up whatever was last deployed. `harness-image.yml`
builds and smokes (`gantry version`) the same file on every
`harness/**` change and publishes the prebuilt copy for anyone who
wants `docker run` without the build: `main` →
`ghcr.io/shotah/gantree-harness:<sha>`, a release tag →
`:vX.Y.Z` and `:latest`.

Build it yourself with any Docker-API engine: `cd harness && docker
build -t gantree-harness:local .` (~70 s warm). Rootless podman is
enough — `systemctl --user enable --now podman.socket` and
`DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock` make the
`docker` CLI talk to it; no daemon, no root. Smoke:
`docker run --rm gantree-harness:local version`.

---

## Release

```bash
npm test
npm run release:dry          # show next tag
npm run release              # patch bump, tag v*, push
npm run release -- --bump=minor
```

Requires a clean tree. Tags trigger `release.yml` (GitHub release) and
`harness-image.yml` (tagged image).

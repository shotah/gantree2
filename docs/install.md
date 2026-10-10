# Install — local, Cloudflare, or home

Same Worker, same `wrangler.jsonc`, three places it runs. Agents open
**zero** inbound ports anywhere: the harness dials the Worker.

| Place | Command | State | Reach it at |
| --- | --- | --- | --- |
| Local dev | `npm run dev` | in-memory, `.wrangler/` | `http://127.0.0.1:3000` |
| Cloudflare | `wrangler deploy` (CI) | Workers · DO · KV · R2 · Containers | your `workers.dev` or custom domain |
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
| Cloudflare | `https://<worker-origin>/api/auth/callback/google` |
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
in `.dev.vars` fakes a session on loopback only. It still has to be in
`GANTREE_ADMINS` or `GANTREE_ALLOW`. Details:
[access.md](access.md#dev-without-google).

Built Worker under Miniflare: `npm run build && npm run start`.

---

## Cloudflare

CI does it. Repository → **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `GOOGLE_CLIENT_ID` | from GCP |
| Variable | `GANTREE_ADMINS` | `you@example.com` (grammar: [access.md](access.md#allowlist-entry-grammar)) |
| Variable | `GANTREE_ALLOW` | optional members |
| Secret | `GOOGLE_CLIENT_SECRET` | from GCP |
| Secret | `SESSION_SECRET` | `openssl rand -base64 48` |
| Secret | `CLOUDFLARE_API_TOKEN` | Workers Scripts Edit · Workers KV Storage Edit · Workers R2 Storage Edit · Account Settings Read |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | dashboard sidebar |

Push to `main`. `ci.yml` runs tests, lint, typecheck, build.
`deploy-cloudflare.yml` then runs `wrangler deploy --var …` and
`wrangler secret bulk`. It fails fast if any of the four auth values is
empty. Add the Worker origin to the Google client's redirect list.

By hand from a laptop (same token in your shell):

```bash
npm run deploy
npx wrangler secret bulk < secrets.json   # {"GOOGLE_CLIENT_SECRET":"…","SESSION_SECRET":"…"}
```

Containers (Phase 2) need the Workers Paid plan; everything in Phase 1
runs on the free tier.

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

Agents run `ghcr.io/shotah/gantree-harness:<tag>` — the Go harness plus
every MCP server in `harness/mcp.lock` baked into `/opt/mcp`.
`harness-image.yml` builds it on changes to `harness/**`, and pushes to
GHCR and the Cloudflare container registry. The Agent DO pins the tag;
**pull + recreate** on `/agents/<slug>` moves an agent to a newer one.
Phase 2.

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

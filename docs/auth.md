# Auth from chat (remote OAuth, no inbound ports)

The harness has no inbound port, so it cannot finish the usual laptop
OAuth dance (`gantry auth google` → localhost callback → copy tokens).
Chat `/auth` does that hop. The Agent DO starts the container and the
harness dials out; nothing listens. Pictures:
[architecture.md](architecture.md).

---

## Two flows

| Flow | Servers | What you do |
| --- | --- | --- |
| **Auth-code paste + PKCE** | `google`, `strava`, `ghealth` | Open URL → approve → copy `code` from catch page → paste into chat |
| **MFA paste** | `garmin` | Creds in `config.env` → `/auth garmin` → email code → `/auth garmin <code>` |

---

## Catch page (PKCE redirect)

Authorize URLs redirect to a static catch page. That page only displays
`?code=` with a copy button. No server logic, no tokens.

The page is `site/oauth-catch/index.html` in this repo, published by
`pages.yml` to the docs site. Why it is static and what it never does:
[security.md](security.md#oauth-for-tools-google-workspace-strava-google-health-).
The URI to register on every provider:

```text
https://shotah.github.io/gantree2/oauth-catch/
```

Plugin binaries still default to the retired `ai-gantry` Pages URI
([todo.md](todo.md) §7 flips them). Until then set the env override and
register the URI above on each client:

| Provider | Env override | Set to |
| --- | --- | --- |
| Google Workspace | `GOOGLE_OAUTH_REDIRECT_URI` | `https://shotah.github.io/gantree2/oauth-catch/` |
| Strava | `STRAVA_OAUTH_REDIRECT_URI` | `https://shotah.github.io/gantree2/oauth-catch/` |
| Google Health | `GOOGLE_HEALTH_OAUTH_REDIRECT_URI` | `https://shotah.github.io/gantree2/oauth-catch/` |

Commented examples belong in `harness/.env.example` (lands with
[todo.md](todo.md) §5). A fork hosts its own copy of the static page and
points the same variables at it — the page has no secrets. The longer
Workspace-scope write-up is not carried.

### Google: you need a **Web application** client

A **Desktop** OAuth client (what laptop `gantry auth google` uses) only allows
`http://localhost:…` redirects. Chat `/auth` sends people to the catch URI
above — Google rejects that on Desktop (`redirect_uri_mismatch` /
“invalid request”).

This is the Workspace / Gmail / Drive client for MCP tools, not the
sign-in client in [install.md](install.md#google-oauth-client).

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials):

1. **Create OAuth client → Web application** (do not try to flip an existing Desktop client).
2. Authorized redirect URIs — add **exactly** (trailing slash matters):
   ```text
   https://shotah.github.io/gantree2/oauth-catch/
   ```
   Optional on the same Web client if you want one pair of secrets for both flows:
   ```text
   http://localhost:4100/oauth2callback
   ```
3. Put that Web client’s ID/secret in `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET` on the agent's `config.env`, then recreate
   (env change recreates — [architecture.md](architecture.md)).
4. Keep the Desktop client for laptop-only auth if you prefer separate secrets.

**Google Health** already uses a **Web** client — add the catch URI alongside
`http://127.0.0.1:4101/oauth2callback` on the same client (same pattern as
Workspace chat `/auth`).

Scopes for Workspace chat auth must include `openid` +
`userinfo.email` (current `google-mcp` defaults) or userinfo returns 401 after
a successful code paste. The plugin lands at `harness/mcp/google`
([todo.md](todo.md) §6).

Expect **"Google hasn't verified this app"** on this flow (Advanced → continue).
It comes from the Gmail/Drive scopes, not the client type. Branding on the
current catch domain names **gantree** with its logo; the interstitial
itself only goes away with scope verification. That write-up is not carried.

### Strava: Authorization Callback Domain

Strava’s app settings take **one domain** (not a path, not a list —
`localhost; shotah.github.io` / commas do not work).

For chat `/auth`, set:

1. [Strava API settings](https://www.strava.com/settings/api) →
   **Authorization Callback Domain** = `shotah.github.io`
   (or your own catch-page host).
2. Leave localhost alone — Strava always whitelists `localhost` /
   `127.0.0.1`, so laptop `gantry auth strava` still works with that domain set.

Chat `/auth strava` is implemented but **not fully smoke-tested** end-to-end
yet — confirm the authorize URL lands on the catch page and
`/auth strava <code>` writes tokens before relying on it.

Localhost interactive auth (`gantry auth <server>`) is
**unchanged** and still uses `http://localhost:…`.

---

## Chat commands

```text
/auth                       # list auth-capable servers
/auth google                # print authorize URL (holds PKCE verifier ~10 min)
/auth google <code>         # exchange pasted code → tokens on disk
/auth strava                # same PKCE paste flow
/auth strava <code>
/auth ghealth               # same PKCE paste flow
/auth ghealth <code>
/auth garmin                # start login (GARMIN_EMAIL/PASSWORD); may ask for MFA
/auth garmin <code>         # paste MFA code from email → session.json
```

PKCE verifier/state (or Garmin MFA cookies) lives in a pending file next
to that MCP's tokens, on the container disk, not in the harness process.
Restarting `/auth <server>` replaces it. Pending files expire (~10 min).

Tokens are not baked into the image and are **not in the R2 snapshot**
today (`gantry.db` + `SELF.md` only), so a recreate means pasting a code
again. Whether they join the snapshot encrypted or move to the Agent DO
is open — [todo.md](todo.md) §5, [security.md](security.md) register #4.

---

## MCP CLI contract (for authors)

Additive subcommands next to interactive `auth` / `login`:

| Chat | MCP argv (after `auth_args`) |
| --- | --- |
| `/auth google` | `url` |
| `/auth google <code>` | `exchange <code>` |
| `/auth strava` | `url` |
| `/auth strava <code>` | `exchange <code>` |
| `/auth ghealth` | `url` |
| `/auth ghealth <code>` | `exchange <code>` |
| `/auth garmin` | `url` |
| `/auth garmin <code>` | `exchange <code>` |

Stdout shape (PKCE / MFA — forwarded into chat):

```text
open <url>   # or: garmin: MFA required (email) — check your email/app …
then paste the code: /auth <server> <code>
guide: docs/auth.md
```

The binary's `guide:` line still names the old repo until the harness
copy rewrites it ([todo.md](todo.md) §5). This page is the guide.

### Garmin (MFA paste)

Put credentials in the agent's `config.env` only (never in chat):

```env
GARMIN_EMAIL=you@example.com
GARMIN_PASSWORD=…
```

Then `/auth garmin` → if Garmin sends MFA, paste `/auth garmin <code>`.
Laptop TTY `gantry auth garmin` still works.

---

## Laptop path (still preferred when you have a browser nearby)

The `gantry` binary lands with the harness tree ([todo.md](todo.md) §5).
Compose docs are not carried.

```bash
gantry auth google      # localhost:4100
gantry auth strava      # localhost:19876
gantry auth ghealth     # 127.0.0.1:4101
gantry auth garmin      # interactive TTY
```

---

## Security notes

- Only the channel allowlist can run `/auth` (`CHAT_ALLOWED_USERS` on
  chat; `TELEGRAM_ALLOWED_USERS`, `DISCORD_ALLOWED_USERS`,
  `SLACK_ALLOWED_USERS` on those mouths). Grammar:
  [access.md](access.md#allowlist-entry-grammar).
- PKCE: a code alone (in chat history) is useless without the verifier on disk.
- Codes are single-use and short-lived; never log them at info level.
- Never paste Garmin (or any) **passwords** into chat — only MFA codes after
  `/auth garmin`. Keep `GARMIN_EMAIL` / `GARMIN_PASSWORD` in `config.env`.

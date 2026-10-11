# Security — risks and choices

What can go wrong, what we chose, and what we did not. One page, so a
reviewer can disagree with a line instead of a feeling.

Code: `lib/door/` (the door), `edge/agent.do.ts` + `lib/chat/` (the
room), `harness/` (the agent). People and roles: [access.md](access.md).
Shape: [architecture.md](architecture.md). Reporting a hole:
[`SECURITY.md`](../SECURITY.md) at the repo root.

---

## What we are protecting

| Asset | Where it lives | Who may hold it |
| --- | --- | --- |
| Your Google identity (`sub`, email) | Session cookie (encrypted), Settings DO `users` | You, the Worker |
| The allowlist and roles | `GANTREE_ADMINS` / `GANTREE_ALLOW` env, Settings DO | Admins |
| The chat thread | Agent DO storage, R2 (photos, boards) | Users on that agent's room |
| The harness bearer (room token) | Agent DO; handed to the container at start | The Worker, that one container |
| Model and tool keys (`LLM_API_KEY`, `GOOGLE_MAPS_API_KEY`, …) | Settings DO per agent → `config` frame → container env | Admins write, the container reads |
| OAuth refresh tokens for tools (Google Workspace, Strava, Google Health, Garmin) | Container `DATA_DIR`, and ciphertext in the R2 snapshot (`tokens_tar`) | Plaintext in that container. The 32-byte key in the Agent DO. R2 and the Worker see ciphertext only |
| The brain (`gantry.db`, `SELF.md`) | Container disk, R2 snapshot | That container only |
| `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `CLOUDFLARE_API_TOKEN` | GitHub Actions secrets → Worker secrets; `.dev.vars` locally; `CELLD_VARS_FILE` at home | The operator |

The failures that matter: a stranger reads a thread, a member gains
admin, a key leaves the box, a stolen phone keeps talking, a plugin we
built ships code we did not read.

---

## Threat model

In scope: anyone on the internet who finds the hostname; a signed-in
member trying to reach another agent or an admin screen; a lost or
stolen phone with a live session; a compromised MCP plugin dependency;
a misconfigured deploy (no admins, wrong redirect URI, secret in a
public var).

Out of scope: Cloudflare or Google themselves; a compromised operator
laptop with the GitHub token; volumetric floods (that is the edge's
job); a model provider that keeps what it is sent (you chose it).

---

## The door

One login: Google. No passphrase, no magic link, no second IdP.

| Choice | Why | Risk accepted |
| --- | --- | --- |
| Google OAuth, authorization code + **PKCE S256** (`lib/door/google.ts`) | No client-side secret, no code interception | Google is a single point of trust |
| **Allowlist**, not open sign-up. Env floor `GANTREE_ADMINS` ∪ `GANTREE_ALLOW` ∪ Settings DO rows (`lib/door/allowlist.ts`) | A stranger with a Google account gets `not_allowed`, nothing else | Admin typo locks a person out; fix is a redeploy or a `/users` edit |
| Env rows are **locked** in `/users` | A DO wipe cannot remove the owner | Env is the floor, not the ceiling |
| **No admins → 503** on every non-public path (`lib/door/gate.ts`) | A deploy with no `GANTREE_ADMINS` serves nothing instead of everything | First deploy fails loudly; that is the point |
| Role **recomputed every request**, never read from the cookie | Demotion and removal take effect on the next click | One DO read per request |
| Principal travels to handlers as `x-gantree-*` **request headers that only the middleware writes**; any the client sent are stripped first (`forwardHeaders`) | Handlers read four headers instead of re-opening the cookie and the user list | Those header names are a trust boundary — a handler reachable without the middleware (none today; `/ws/` authenticates itself) would trust the client. `test/door/forward.test.ts` pins the strip |
| Cookie `gantree_session`: **JWE** dir/A256GCM, key = SHA-256 of `SESSION_SECRET` (≥32 chars) | Opaque to the browser, tamper-evident, no server session table | Rotating `SESSION_SECRET` logs everyone out; no per-session revoke list |
| `HttpOnly`, `SameSite=Lax`, `Secure` except plain-http loopback, `Max-Age` 7 days hard | Standard; no JWT in `localStorage` | 7-day window on a stolen phone — see below |
| `gantree_oauth` state cookie, 10 minutes, carries the PKCE verifier | Binds callback to the browser that started | — |
| Public paths are an explicit list (`PUBLIC_EXACT` / `PUBLIC_PREFIX`) | Everything else is gated by default | A new asset route must be added deliberately |
| `GANTREE_DEV_USER` honored **only** when the request host is loopback | Dev convenience that cannot leak to a LAN or a tunnel | A dev who proxies loopback through a tunnel defeats it; do not |

Not a CSRF-token system: cookie is `SameSite=Lax`, mutating routes are
`POST` same-origin JSON. Not a rate limiter: Google does the guessing
defense; the allowlist makes a correct password useless anyway.

### Roles

| Role | Can |
| --- | --- |
| **admin** | Everything: users, every agent, keys, retire |
| **operator** | Assigned agents: config, grants, keys, restart. Not users, not other agents |
| **member** | Assigned agents: chat. Not settings |

Three named roles, one field. Not a permission matrix.

---

## The room (Agent Durable Object)

| Choice | Why | Risk accepted |
| --- | --- | --- |
| One DO per agent slug; the room list (`sub` / email) decides who may join | Isolation is the object boundary, not a `WHERE` clause | A slug typo creates an empty room, not a shared one |
| Phones authenticate with the **session JWE** (the PWA's cookie; the native apps carry the same token on `Authorization`, minted by `POST /api/auth/token` — [access.md](access.md#phones-native-sign-in)); the harness with a **bearer** the DO minted | Two credentials, two audiences; a phone cannot impersonate the agent | Bearer lives in the container env for the life of the box |
| Bearer rotates on `recreate`; the old one dies with the box | No long-lived agent credential | — |
| Payload caps, per-socket rate limit, slug validation (`lib/chat/caps.ts`, `rate.ts`, `slug.ts`) | A member cannot fill storage or flood the harness | Slow phone drops oldest and says so |
| Backlog bounded; photos and boards in R2 under the slug prefix | Storage is per agent | R2 keys are not encrypted at rest beyond Cloudflare's own |
| Theme and typing notices are broadcast; **text is only sent to sockets on the room list** | A dropped member stops seeing new turns immediately | They keep what their phone already cached |

The harness never listens. Cloud or home, the container dials the Worker
with the bearer. There is no port to scan, no webhook URL to guess.

---

## The harness container

| Choice | Why | Risk accepted |
| --- | --- | --- |
| Outbound only; no inbound ports on either target | Unchanged from the first design; the whole product rests on it | — |
| Secrets arrive in the `config` frame over the authenticated socket, not baked into the image | One image for every agent; keys never in a layer | Keys are in container memory and env; `docker inspect` on a home box shows them to root |
| One OCI image, built in CI from this repo, MCP plugins compiled from `harness/mcp/<id>/` source | No binary we did not build; `mcp.lock` names every plugin | Go module supply chain is the remaining trust |
| `host-manifest` shapes shipped in the image; the settings grid trusts the image, not a registry | Tool catalog cannot be swapped under the UI | — |
| Brain snapshot (`gantry.db`, `SELF.md`) and the token archive (`tokens_tar`) → **R2** via presigned PUT, restored via presigned GET on start; off unless `SNAPSHOT=true` | Containers have no durable disk; the person and tool logins survive a restart on Cloudflare, celld, and `npm run agent` | `gantry.db` and `SELF.md` rely on Cloudflare's at-rest encryption. `tokens_tar` is AES-256-GCM with a per-agent key (register #4). No matching token files skips that PUT. A 404 on GET is a no-op. A missing key skips the archive; plaintext is never uploaded |
| Per-agent log fan-out rate-capped; the harness never logs a key or a token body | A chatty log cannot become a leak | We rely on discipline in plugin code; name-lock tests do not scan log lines |

Plugins run as child processes of the harness inside the same container.
A compromised plugin has the harness's keys for that agent — not other
agents, not the Worker. That is the blast radius we chose by baking them
into one image instead of running fifteen sidecars.

---

## OAuth for tools (Google Workspace, Strava, Google Health, …)

The harness is headless. Connecting a Google account to an agent is a
browser hop that ends on a **static page**:

```text
https://github.bldhosting.com/oauth-catch/
```

| Choice | Why |
| --- | --- |
| The catch page is static HTML on GitHub Pages (`site/oauth-catch/index.html`). It reads `?code=` from the URL, shows it, offers copy, strips it from history. **No server receives the code.** | Nothing to breach; nothing logged |
| You paste the code into chat: `/auth <server> <code>`. The plugin exchanges it from inside the container with its own client secret | The code is one-time and short-lived. Plaintext refresh tokens stay in the container; the snapshot copy is AES-256-GCM ciphertext |
| Each plugin's `*_OAUTH_REDIRECT_URI` must equal the URL registered with the provider | Google rejects anything else |
| The privacy policy Google's consent screen points at is `https://github.bldhosting.com/privacy/` (`site/privacy/index.html`) | Required for verification; versioned with the code |
| Garmin has no public OAuth: the operator signs in on their own machine and the session file lands in the data dir | We do not proxy a vendor login |

This is a different Google OAuth client than the door's. The door's
redirect is `/api/auth/callback/google` on **your** Worker hostname and
asks for identity only. The tool client asks for Gmail/Calendar/Drive
scopes and redirects to the catch page. Keep them separate in Google
Cloud so revoking one does not break the other.

---

## Secrets — where each one is allowed to be

| Name | Local | Cloudflare | Home (celld) | Never |
| --- | --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | `.dev.vars` | Actions **var** → Worker var | `CELLD_VARS_FILE` | — |
| `GOOGLE_CLIENT_SECRET` | `.dev.vars` | Actions **secret** → Worker secret | `CELLD_VARS_FILE` | a var, a commit, a log |
| `SESSION_SECRET` | `.dev.vars` | Actions **secret** | `CELLD_VARS_FILE` | shorter than 32 chars; reused across deployments |
| `GANTREE_ADMINS`, `GANTREE_ALLOW` | `.dev.vars` | Actions **var** | `CELLD_VARS_FILE` | — (emails are not secrets, but they are PII — keep them out of the README) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | — | Actions **secret** | — | the Worker's env |
| Per-agent keys (`LLM_API_KEY`, tool keys) | Agent DO (config record) | Agent DO | Agent DO | env of the Worker; a plugin's log |
| `VAPID_*` (push) | `.dev.vars` | Actions secret | `CELLD_VARS_FILE` | — |

`.dev.vars` and `harness/.env` are gitignored. `.dev.vars.example` and
`harness/.env.example` carry names, never values. CI fails if a test
fixture contains a string that looks like a live Google secret.

---

## What the service holds — the inventory

Everything a deployment stores about the people and agents on it, read
off the code on 2026-10-10. This is the list a Terms of Service and a
privacy policy describe; nothing else is written anywhere. In one
line: **credentials, chat, and who-may-talk-to-whom.** The credentials
are the heavy part.

### Settings Durable Object — one per deployment

| Table / key | What is in it | Kept |
| --- | --- | --- |
| `users` | Google `sub`, email, role (`admin` / `operator` / `member`), which agents the person may reach, who added them and when | until removed on `/users` |
| `agents` | slug, display name, creator, created-at, tags | until the agent is retired |
| `audit` | time, who (sub), action (`user.add`, `agent.remove`, …), detail (slug or email) — the admin history | indefinitely |
| `samples` | per agent, per turn: `tokens_prompt`, `tokens_completion`, `turn` ms — numbers only, no text, no person | indefinitely (spend chart) |

### Agent Durable Object — one per agent

| Key | What is in it | Kept |
| --- | --- | --- |
| `config` | **Every secret pasted on the Keys or Tools fold, in plaintext**: `LLM_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `RENTCAST_API_KEY`, `STRAVA_CLIENT_SECRET`, … plus the persona text and the list of granted tools | until changed or the agent is retired |
| `bearer` | the room bearer the harness authenticates with | until retire |
| `snapshot.key` | the 32-byte key that decrypts the agent's `tokens_tar` — so **the deployment can read the OAuth refresh tokens it stores in R2** | until retire |
| `allow` + hash | who is in the room (sub, `sub:email`, or email) | until edited |
| `q:*` message queue | the chat itself: the last **50 messages** or **8 MiB** per side, each dropped after **1 hour** — a reconnect backlog, not an archive | ≤ 1 h |
| `aims`, `todo`, `cmds` (per user and per room) | the agent's goals and task boards written from chat — plain text people typed or the agent wrote | until edited |
| `theme`, avatar / backdrop blobs | how the chat looks; the avatar and backdrop are JPEGs people or the agent uploaded | until replaced |
| push subscriptions | per user: the browser's push endpoint and keys | until unsubscribed |
| `log` (folded), `perf`, `status` | the harness's own log lines (rate-capped, bodies off), timing, which plugins came up | rolling |

### KV `DIRECTORY`

`sub → [slugs]`: which rooms each person may enter, mirrored from the
Agent DOs so `/api/auth/me` answers without waking them. No names, no
text.

### R2 `STORE` — `backups/<slug>/latest/` and `backups/<slug>/<stamp>/`

| Object | What is in it | Encrypted |
| --- | --- | --- |
| `gantry_db` | the harness's SQLite: `session` / `session_message` (**the full chat history** per person, as the model saw it, including tool calls and results), `memory` (what the agent chose to remember about people), self-notes, cron jobs, aims | no — R2 at rest only |
| `self_md` | the agent's own persona notes | no |
| `tokens_tar` | **OAuth refresh tokens** for Google Workspace, Strava, Google Health, Garmin — the keys to someone's Gmail, Drive, Calendar, health data | AES-256-GCM with the Agent DO's `snapshot.key` |

Every 5 minutes and on shutdown a new stamp lands; nothing prunes them
yet ([todo.md](todo.md) backup loop).

### In flight and on the box

- **Session cookie**: an encrypted token carrying `sub` and email, 7
  days, `HttpOnly`. Role is not in it.
- **Harness container**: while running it holds all of the above
  decrypted in memory and under `DATA_DIR` — keys, tokens, the full
  SQLite. On Cloudflare that disk is gone on stop; on celld `/data` is
  a volume and keeps it.
- **LLM provider**: every turn's prompt — persona, memory, the
  person's messages, tool results — goes to whichever model endpoint
  the agent's `LLM_BASE_URL` names, under the key they pasted. We do
  not see that traffic; the provider's terms apply to it.
- **Plugins' vendors**: Google, Strava, RentCast, SerpAPI, … receive
  exactly the tool calls the agent makes, under the person's own
  client or key.

### Not held

Google passwords (sign-in is OpenID Connect; `lib/door/google.ts` reads
`sub` and `email` off the ID token and nothing else — no name, no
picture). Card or billing data (a merchant of record
would hold it). The person's Google data itself — mail, files, events
are fetched per call and live in the chat and the SQLite above only as
far as the agent repeated them.

### What hosting changes

Self-hosted, every row above is in **your** Cloudflare account or on
**your** box. Hosted ([monetize.md](monetize.md)), the same rows are in
ours, which is why the Hosted plan needs a Terms of Service, a privacy
policy that says this list, and an entity to sign them — and why the
tool OAuth clients stay the customer's: we hold the refresh tokens
encrypted, but a shared client would make us the party Google holds
responsible for them.

---

## Supply chain

| Surface | Control |
| --- | --- |
| npm | `package-lock.json`; `npm ci` in CI; ncu is a deliberate PR, not a bot |
| Go | `go.sum` per module; `harness/mcp.lock` names every plugin and its module path; name-lock tests pin server ids and tool names |
| Image | Built in this repo's Actions from source; tagged by release; published to GHCR under the repo's identity |
| GitHub Pages | Only `pages.yml`, `ci.yml`, `harness.yml` write `gh-pages`, each to its own paths, serialized by a concurrency group |
| Actions | Pinned major versions; `persist-credentials: false`; `contents: write` only where a push is needed |

---

## Logging

The Worker logs method, path, status, `sub` (not email), duration.
Never a cookie, a bearer, a code, a key. The harness mirrors slog over
the socket at a bounded rate; the DO stores a ring, not forever. Audit
rows (who/what/when) for every user and key mutation live in the
Settings DO and are readable by admins only. Not a SIEM.

---

## Risk register

| # | Risk | Likelihood | Impact | Choice | Open? |
| --- | --- | --- | --- | --- | --- |
| 1 | Stolen phone with a live session | Medium | Member reads their own rooms for ≤7 days | Role recomputed per request, so **removal on `/users` ends it at the next request**; no per-device revoke | Per-device sessions list — later |
| 2 | `GANTREE_ADMINS` empty on deploy | Medium (first deploy) | None — 503 | Fail closed | No |
| 3 | Admin adds the wrong email | Medium | Stranger with that address can sign in | Allowlist is exact-match; audit row; `/users` shows last sign-in | Confirm-scary on add — §2 todo |
| 4 | R2 copy of OAuth refresh tokens (`tokens_tar`) | Low | That agent's tool tokens, if the per-agent key is also taken | Ciphertext only in R2. AES-256-GCM, random 12-byte nonce prefixed to the body. Key is 32 bytes minted once in the Agent DO (`snapshot.key`, next to the room bearer) and sent on the config frame as `SNAPSHOT_KEY` (base64). Presigned GET/PUT ≤15 min. The Worker never decrypts. No token files skips the PUT; HTTP 404 on GET is a no-op; a missing key skips the archive and is logged once. Plaintext is never uploaded | No |
| 5 | Malicious or vulnerable Go dependency in a plugin | Low–Medium | Keys of that agent | Built from source, `go.sum`, Dependabot on `harness/**` | Sandbox plugins (gVisor at home: `CELLD_CONTAINER_RUNTIME=runsc`) — later |
| 6 | Harness bearer leaked from container env | Low | Someone speaks as the agent in that room | Bearer per box life; `recreate` rotates; the DO accepts one harness socket at a time | No |
| 7 | OAuth code pasted into the wrong chat | Low | Code is one-time, 10-minute, useless without the plugin's client secret | Catch page strips URL; `/auth` only in the agent's own room | No |
| 8 | `GANTREE_DEV_USER` set in production | Low | None unless the host is loopback | Loopback check on the request URL | No |
| 9 | Prompt injection via a tool result (email, web page) makes the agent call a destructive tool | Medium | Whatever the granted tools can do | Grants are per agent and explicit; destructive tools are not granted by default; the eval suite includes injection fixtures | Per-tool confirm in chat — later |
| 10 | celld repo/binary churn after the Cloudflare acquisition | Medium | Home deploy breaks | Version pinned in `install.md`; `npm run deploy:home` is the only invocation site | Watch |

---

## Not this

- A WAN-open home box. celld sits behind Tailscale HTTPS or a Tunnel.
- Cloudflare Access in front of the Worker. The door is the product.
- Role or permissions in the cookie.
- A second login (passphrase, magic link, SSO beyond Google).
- Pairing codes in chat; MCP OAuth as a phone login.
- CSRF tokens; `SameSite=Lax` and same-origin `POST` JSON.
- Encrypting `gantry.db` and `SELF.md` beyond Cloudflare's at-rest
  encryption. The token archive is the exception (register #4).
- A 12-role RBAC. Three roles.

---

## Operator checklist

1. Two Google OAuth clients: **door** (redirect `/api/auth/callback/google`
   on your hostname, identity scopes) and **tools** (redirect the catch
   page URL, the scopes you grant). Privacy policy URL = the `privacy/`
   page.
2. `GANTREE_ADMINS` set before the first deploy. `SESSION_SECRET` ≥32
   random chars, generated once, stored only as a secret.
3. Home: Tailscale or Tunnel. No router port.
4. A partner needs keys for one agent → **operator** on that agent, not
   admin.
5. Someone leaves → `/users` → remove. Their next request is 401.
6. Rotate `SESSION_SECRET` if you suspect a leak; everyone logs in
   again, nothing else breaks.
7. Never set `GANTREE_DEV_USER` outside `.dev.vars`.

Tests: `test/door/*` (gate, session, allowlist, Google flow, bounces),
`test/chat/*` (caps, rate, slug, admission), `test/edge/*` (DO glue),
`harness/**/*_test.go` (frames, snapshot round-trip, plugin name locks).

# Security — risks and choices

What can go wrong, what we chose, and what we did not. One page, so a
reviewer can disagree with a line instead of a feeling.

Code: `lib/door/` (the door), `edge/agent.do.ts` + `lib/chat/` (the
room), `brain/` (the agent).
People and roles: [access.md](access.md).
Shape: [architecture.md](architecture.md). Reporting a hole:
[`SECURITY.md`](../SECURITY.md) at the repo root.

---

## What we are protecting

| Asset | Where it lives | Who may hold it |
| --- | --- | --- |
| Your Google identity (`sub`, email) | Session cookie (encrypted), Settings DO `users` | You, the Worker |
| The allowlist and roles | `GANTREE_ADMINS` / `GANTREE_ALLOW` env, Settings DO | Admins |
| The chat thread | Agent DO: the room queue and the session rows | Users on that agent's room |
| The room bearer | Agent DO. Also the token on face / wallpaper / theme | The Worker |
| Model and tool keys (`LLM_API_KEY`, `GOOGLE_MAPS_API_KEY`, …) | Agent DO `config.env`, in plaintext. House `LLM_*` on the Worker | Admins write. The brain reads |
| OAuth refresh tokens for tools (Google Workspace, Strava, Google Health, Garmin) | `oauth_token` in the Agent DO, AES-256-GCM under `snapshot.key` | The plugin, for the call |
| The brain | DO SQLite (`persona_file`, `selfnote`, sessions, memory, cron) | That agent only |
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

## The HTTP API

The harness opens no listen port and has no webhook. A turn is a method
call inside the Agent Durable Object. The Vinext Worker is the inbound
HTTP API. Cloudflare fronts it. The route catalog is
[openapi.yaml](openapi.yaml).

Worker code answers `GET /ws/{slug}` in `worker/index.ts` before
Vinext middleware runs, so the room bearer is not refused for lacking a
session cookie. Every other path passes `lib/door/gate.ts` in
`middleware.ts` first.

Internal DO fetches use `https://agent/...` with `X-Chat-Op`. That
header is Worker-to-DO glue. It is not an internet route.

| Mechanism | Where it applies | Check |
| --- | --- | --- |
| **Public paths** | Exact list in `PUBLIC_EXACT` plus prefixes `/_vinext/`, `/.well-known/`, `/_next/`, `/assets/` | No session |
| **Session cookie** `gantree_session` | Non-public pages and `/api/*` except room-bearer bypass | JWE; cookie wins when it opens |
| **Session bearer** | Same JWE on `Authorization: Bearer` when the cookie does not open | Cab and Helm; same gate read as the cookie |
| **Room bearer** | `GET`, `POST`, `DELETE` on `/api/chat/avatar`, `/api/chat/backdrop`, `/api/chat/theme` when `Authorization: Bearer` is present | Gate treats the header as public; `admitRoom` checks `AGENT_BEARERS` or the DO row. A mismatch is 401 and does not fall through to the session |
| **Native Google proof** | `GET /api/auth/config`, `GET /api/auth/nonce`, `POST /api/auth/token` | Public at the gate; proof is ID token plus server nonce — [access.md](access.md#phones-native-sign-in) |
| **Catch cookie only** | `GET /api/auth/catch` is public at the gate; the handler opens the session from `gantree_session` via `readCookie` | Admin or room membership, then code exchange |
| **Mailbox socket** | `GET /ws/{slug}?role=phone`, `crane`, or `agent` | Phone: session cookie or session bearer, then room list. Crane or agent: room bearer in `Authorization`. Origin must match (`upgradeOriginOk`) or 403. OIDC mode ignores query `bearer` |
| **Spike** | Loopback only when `GOOGLE_CLIENT_ID` is unset and `CHAT_SECRET` is set | Query `secret`; a non-loopback host with only the spike secret is config failure (503). Production with Google configured does not use spike |
| **No admins** | Every non-public path | 503 until `GANTREE_ADMINS` parses |

After the gate, handlers trust `x-gantree-*` headers the middleware sets.
Client copies of those names are stripped first.

| Path family | Who may call |
| --- | --- |
| `/api/users` | **admin** |
| `/api/agents`, `/api/samples` | **admin** sees all; **operator** only assigned slugs (`canRunAgent`); **member** is 403 |
| `POST` and `DELETE /api/agents` | **admin** |
| `GET /api/tools`, `GET /api/auth/me` | Any signed-in role |
| `GET /api/agents/{slug}/bearer` | **admin**, and only when `GANTREE_DEV_USER` is honored (set and loopback host); every other host is 404 |
| Chat HTTP (session): push, TTS, and other `/api/chat/*` not in the room-bearer trio | Session from the gate, then the agent room list (`admitRoom` / `readChatUser`). Env floor `GANTREE_ADMINS` ∪ `GANTREE_ALLOW` matches the socket rule in [access.md](access.md#room-admission-wsagent-id) |

Principal headers carry `sub`, email, role, and assigned agents. Role is
recomputed every request and is not stored in the cookie.

---

## The room (Agent Durable Object)

| Choice | Why | Risk accepted |
| --- | --- | --- |
| One DO per agent slug; the room list (`sub` / email) decides who may join | Isolation is the object boundary, not a `WHERE` clause | A slug typo creates an empty room, not a shared one |
| Phones authenticate with the **session JWE** (the PWA's cookie; the apps carry the same token on `Authorization`, minted by `POST /api/auth/token` — [access.md](access.md#phones-native-sign-in)) | A phone session is not an agent credential | The room bearer on face / wallpaper / theme is a separate token |
| Payload caps, per-socket rate limit, slug validation (`lib/chat/caps.ts`, `rate.ts`, `slug.ts`) | A member cannot fill storage or flood the room | Slow phone drops oldest and says so |
| Backlog bounded; avatar and backdrop are blobs on the DO | Storage is per agent | — |
| Theme and typing notices are broadcast; **text is only sent to sockets on the room list** | A dropped member stops seeing new turns immediately | They keep what their phone already cached |

OAuth tokens are ciphertext in that DO's SQLite (`oauth_token`),
AES-256-GCM under `snapshot.key` (`AesTokenStore` in `brain/tools`).
The plugin sees plaintext for the call. The key stays on the DO. A bug
in a plugin is that agent's env and tokens, not another agent's.

---

## OAuth for tools (Google Workspace, Strava, Google Health, …)

`/auth <plugin>` and the Tools-fold Connect button return the provider
URL with `state` sealed as an `oauth-catch` JWE. `GET /api/auth/catch`
requires the `gantree_session` cookie (`readCookie`; the handler does
not read `Authorization`) and an admin or a member of that room, posts
the code to the DO, and `authFinish` stores ciphertext in
`oauth_token`. The room gets `<plugin> connected`. The code is not
written to the log. Detail: [auth.md](auth.md).

Register exactly, no trailing slash:

```text
https://gantree2.bldhosting.com/api/auth/catch
http://127.0.0.1:3000/api/auth/catch
```

`PUBLIC_ORIGIN` overrides the host.

| Choice | Why |
| --- | --- |
| The catch is a Worker route, not a static page. The path is public at the gate so a missing cookie is a plain-text 401. The handler still requires the session | The code is exchanged once and not stored in the URL history of a docs site |
| Garmin has no public OAuth. `/auth garmin`, then the emailed code | We do not proxy a vendor login |
| The privacy policy Google's consent screen points at is `https://github.bldhosting.com/privacy/` | Required for verification; versioned with the code |

This is a different Google OAuth client than the door's. The door's
redirect is `/api/auth/callback/google` and asks for identity only.
The tool client asks for the scopes you grant and redirects to the
catch. Keep them separate in Google Cloud so revoking one does not
break the other.

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

`.dev.vars` is gitignored. `.dev.vars.example` carries names, never
values. CI fails if a test fixture contains a string that looks like a
live Google secret.

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
| `config` | **Every secret pasted on the Keys or Tools fold, in plaintext**: `LLM_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `RENTCAST_API_KEY`, `STRAVA_CLIENT_SECRET`, … plus the persona seed and the grant list | until changed or the agent is retired |
| `bearer` | the token on `/api/chat/{avatar,backdrop,theme}` | until retire |
| `snapshot.key` | the 32-byte key that decrypts `oauth_token` in this DO | until retire |
| `persona_file`, `selfnote` | `PERSONA.md` and `SELF.md` | until edited |
| `oauth_token` | OAuth access and refresh tokens, AES-256-GCM, nonce prefixed. Providers `google`, `strava`, `garmin`, and the same shape for any plugin that stores one | until deleted |
| sessions, memory, cron, watches | the chat the model saw, memories, jobs, watch cursors | until the agent is retired |
| `allow` + hash | who is in the room (sub, `sub:email`, or email) | until edited |
| `q:*` message queue | the chat itself: the last **50 messages** or **8 MiB** per side, each dropped after **1 hour** — a reconnect backlog, not an archive | ≤ 1 h |
| `aims`, `todo`, `cmds` (per user and per room) | the agent's goals and task boards written from chat — plain text people typed or the agent wrote | until edited |
| `theme`, avatar / backdrop blobs | how the chat looks; the avatar and backdrop are JPEGs people or the agent uploaded | until replaced |
| push subscriptions | per user: the browser's push endpoint and keys | until unsubscribed |
| `log` (folded), `perf`, `status` | log lines (rate-capped, bodies off), timing, which plugins came up | rolling |

### KV `DIRECTORY`

`sub → [slugs]`: which rooms each person may enter, mirrored from the
Agent DOs so `/api/auth/me` answers without waking them. No names, no
text.

### In flight and on the box

- **Session cookie**: an encrypted token carrying `sub` and email, 7
  days, `HttpOnly`. Role is not in it.
- **Isolate**: while a turn runs it holds `config.env` and, for a
  plugin call, the decrypted OAuth token. SQLite keeps the ciphertext.
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
| GitHub Pages | `pages.yml` and `ci.yml` write `gh-pages`, each to its own paths |
| Actions | Pinned major versions; `persist-credentials: false`; `contents: write` only where a push is needed |

---

## Logging

The Worker logs method, path, status, `sub` (not email), duration.
Never a cookie, a bearer, a code, a key. The DO stores a log ring, not
forever. Audit
rows (who/what/when) for every user and key mutation live in the
Settings DO and are readable by admins only. Not a SIEM.

---

## Risk register

| # | Risk | Likelihood | Impact | Choice | Open? |
| --- | --- | --- | --- | --- | --- |
| 1 | Stolen phone with a live session | Medium | Member reads their own rooms for ≤7 days | Role recomputed per request, so **removal on `/users` ends it at the next request**; no per-device revoke | Per-device sessions list — later |
| 2 | `GANTREE_ADMINS` empty on deploy | Medium (first deploy) | None — 503 | Fail closed | No |
| 3 | Admin adds the wrong email | Medium | Stranger with that address can sign in | Allowlist is exact-match; audit row; `/users` shows last sign-in | Confirm-scary on add — §2 todo |
| 4 | OAuth refresh tokens | Low | That agent's tool tokens, if `snapshot.key` is also taken | Ciphertext in the Agent DO (`oauth_token`), AES-256-GCM. The DO decrypts for the plugin | No |
| 5 | Malicious or vulnerable npm dependency in a plugin | Low–Medium | Keys of that agent | `package-lock.json`, `npm ci` | Review dependency diffs |
| 6 | Room bearer leaked | Low | Someone fetches that agent's face, wallpaper, or theme on `/api/chat/avatar`, `/api/chat/backdrop`, or `/api/chat/theme` | Bearer is per agent. It is not a phone session | No |
| 7 | OAuth code used outside the room | Low | Code is one-time and useless without the plugin's client secret | Catch requires the session cookie and admin or room membership | No |
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
- A 12-role RBAC. Three roles.

---

## Operator checklist

1. Two Google OAuth clients: **door** (redirect `/api/auth/callback/google`
   on your hostname, identity scopes) and **tools** (redirect exactly
   `https://gantree2.bldhosting.com/api/auth/catch` and
   `http://127.0.0.1:3000/api/auth/catch`, no trailing slash, plus the
   scopes you grant). `PUBLIC_ORIGIN` overrides the host. Privacy
   policy URL = the `privacy/` page.
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
`test/brain/*` (the agent).

# Access — who may operate, who may talk

One repo, one door, one household. This page is how a **person** lines
up across settings, chat, and the agent: the Google sign-in, the list
that says whether you may be here, the role that says what you may
touch, and the room list each agent obeys.

Pictures: [architecture.md](architecture.md) §2–§4 and §6. Why the
door is Google and not a passphrase: [proposal.md](proposal.md#auth-one-door).
Setup by place: [install.md](install.md). Open walks: [todo.md](todo.md).

---

## Two populations, one sign-in

| Who | Wants | Needs |
| --- | --- | --- |
| **Operators** | to *touch* an agent — config, tools, recreate, users | a Google account on the list with role `admin` or `operator` |
| **Members** | the agent to *answer* | a Google account on the list **and** on that agent's room list |

Bob can operate Kit and never message her. Ada can message Kit from
her phone and never see settings. Both sign in at the same `/login`.
There is no second door and no passphrase.

```text
            Google sign-in  →  gantree_session {sub, email}
                                     │
                     gate, every request (never from the cookie)
                                     │
         ┌───────────────────────────┼────────────────────────────┐
   GANTREE_ADMINS           GANTREE_ALLOW              Settings DO users
   admin · locked           member · locked            admin / operator(agents) / member
         └───────────────────────────┼────────────────────────────┘
                                     │  role
         /users /settings  admin ────┤
         /agents/<slug>    admin, or operator with <slug> in agents[]
         /chat/<slug>      any role  ──┐
                                       └─ and on Agent:<slug> room list
                                          (wire name PENDANT_ALLOWED_USERS)
```

---

## The principle

**One identity (`sub`), one app list, one room list per agent, every
check at request time.**

- Google proves *who*. It never says *whether*.
- The app list (env floor ∪ Settings DO rows) says whether you may be
  here at all, and with what role.
- The agent's room list says whether that agent will talk to you. It
  lives in the agent's `config.env` on the Agent DO as
  `PENDANT_ALLOWED_USERS`, is handed to the harness at start, and the
  harness publishes it back on dial as an `allow` frame. Settings edits
  it; nothing else does.
- A cookie only proves who. Removing a person from a list ends their
  access on the next request, not at cookie expiry.

---

## Shared contract

Every piece of this repo — and cab, helm, and any agent still on the
original stack — codes to this section. Change it here first.

### Allowlist entry grammar

Comma or whitespace separated. Three forms. Same grammar for
`GANTREE_ADMINS`, `GANTREE_ALLOW`, Settings DO rows, and every
agent's `PENDANT_ALLOWED_USERS`.

| Entry | Parse |
| --- | --- |
| `118212345678901234567` | `sub` = 10–32 digits |
| `118212345678901234567:ada@example.com` | split at the **first** `:`; `sub` left, email right (lowercased) |
| `ada@example.com` | no `:` and contains `@` → email only, lowercased |

Normalize: trim, drop empties, dedupe by `sub` then by email. Junk is a
dropped entry with a warning in settings and a config error at harness
boot. Code: `lib/door/allowlist.ts`.

### Matching

| Entry has | Matches when |
| --- | --- |
| `sub` | `sub` equals the token's `sub`, exactly |
| `email` | token's `email_verified` is true **and** lowercased `email` equals, exactly. No Gmail-dot or `+tag` folding. |
| both | either |

`sub` is the key: it survives an email change. Email is an alias: it
only ever *matches*, never *identifies*. Session ids and `user_id` on
frames are always `sub`.

### Roles

| Role | From | May |
| --- | --- | --- |
| `admin` | `GANTREE_ADMINS` (locked) or a Settings row | everything: `/users`, `/settings`, every agent, every chat the room list allows |
| `operator` | Settings row with `agents[]` | `/agents/<slug>` for listed slugs; chat where the room list allows |
| `member` | `GANTREE_ALLOW` (locked) or a Settings row | chat where the room list allows; `/api/auth/me` |

Resolution is per request: collect every row that matches, take the
highest role, union the operators' `agents[]`. Env rows are **locked**:
settings shows them and cannot remove them; edit the env to change
them. Empty `GANTREE_ADMINS` → every gated route is `503` until it is
set. Code: `lib/door/users.ts`.

### Cookies

| Cookie | Holds | Life | Flags |
| --- | --- | --- | --- |
| `gantree_oauth` | `state`, `nonce`, `code_verifier`, `next` | 10 min | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| `gantree_session` | `{ sub, email }` | **7 days, hard** | same |

Both are JWE (`dir` + `A256GCM`); key = SHA-256 of `SESSION_SECRET`
(≥ 32 chars). `Secure` is dropped only on loopback `http`. Nothing else
is in the cookie: no role, no agents, no name. Code: `lib/door/session.ts`.

### Google

Authorization Code + PKCE (`S256`), scopes `openid email profile`,
`prompt=select_account`. ID token verified with `jose`: `iss` in
`accounts.google.com` / `https://accounts.google.com`, `aud` =
`GOOGLE_CLIENT_ID`, `exp`, signature from Google's JWKS, and our
`nonce`. Nobody decodes a JWT by hand. Code: `lib/door/google.ts`.

### Gate, every non-public request

| Situation | Page | `/api/*`, `/ws/*` |
| --- | --- | --- |
| public path | through | through |
| no admins configured | `503` | `503` |
| no / bad / expired cookie | `302 /login?next=<path>` | `401 {"error":"unauthorized"}` |
| cookie, not on any list | `401` | `401` |
| on a list | through, `x-gantree-sub/email/role/agents` set | same |

Public: `/login`, `/api/auth/google`, `/api/auth/callback/google`,
`/manifest.webmanifest`, `/sw.js`, `/icon.svg`, `/favicon.ico`,
`/robots.txt`, `/_vinext/*`, `/_next/*`, `/assets/*`, `/.well-known/*`.
Code: `lib/door/gate.ts`, `lib/door/http.ts`, `middleware.ts`.

### `/api/auth/me`

```json
{ "sub": "118212345678901234567", "email": "ada@example.com",
  "role": "member", "agents": ["kit"] }
```

`agents` for a member is the slugs whose room list has them (KV
directory `sub:<sub>` / `email:<email>` → slugs, written by each Agent
DO when it stores an `allow` frame). For an operator it is their
assignment. For an admin it is every slug. Cab and helm read this
today as `cranes`; the alias stays until Phase 4. The only identity a
stranger sees is their own.

### Room admission (`/ws/<slug>`)

| Check | Where | On miss |
| --- | --- | --- |
| harness: bearer bound to this slug | handshake | `unauthorized` |
| phone: `gantree_session` opens, person is on the app list | handshake, every frame | `4401` |
| phone: `sub` ∈ room list **or** (`email_verified` ∧ `email` ∈ room list) | handshake, every frame | `4403` |

Room list = last `allow` frame stored on that slug's Agent DO. New
`allow` → re-check every phone socket; close the ones no longer on it.
Admins are **not** exempt from the room list: operating Kit and
talking to Kit are different grants.

### Frames (harness ↔ room)

Harness → room, right after `cmds`, and again on every reconnect:

```json
{ "kind": "allow", "users": [
  { "sub": "118212345678901234567", "email": "ada@example.com" },
  { "email": "bob@example.com" }
] }
```

Room → harness, `email` beside `user_id`:

```json
{ "kind": "msg", "user_id": "118212345678901234567",
  "email": "ada@example.com", "text": "…", "context": { } }
```

The harness admits a frame when `user_id` **or** `email` is on its
list. Session id: `pendant:<slug>:<sub>` (wire name; Phase 4 renames).

---

## Seeding — where the first people come from

| Place | `GANTREE_ADMINS`, `GANTREE_ALLOW`, `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` |
| --- | --- | --- |
| Local dev | `.dev.vars` | `.dev.vars` |
| Cloudflare | GitHub Actions **variables** → `wrangler deploy --var` | GitHub Actions **secrets** → `wrangler secret bulk` |
| Home (celld) | `CELLD_VARS_FILE` | `CELLD_VARS_FILE` |

The env is the floor. Everyone else is a row on the Settings DO, added
on `/users` by an admin. Never commit `.dev.vars`.

### Dev without Google

`GANTREE_DEV_USER=118212345678901234567:you@example.com` in `.dev.vars`
fakes a signed-in session **only** when the request host is
`127.0.0.1` / `localhost`. The gate refuses it on any other host. The
dev user still has to be on a list.

---

## End to end

### Once

1. GCP → APIs & Services → Credentials → OAuth client ID → **Web
   application**. Scopes `openid email profile`. One client can carry
   every redirect below. Table: [install.md](install.md#google-oauth-client).
2. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`,
   and your email in `GANTREE_ADMINS` where that place reads them.
3. Deploy. Open `/`. Sign in. You are admin.

### Add an operator

`/users` → add `bob@example.com`, role `operator`, agents `kit`. Bob
signs in; `/agents/kit` opens; `/agents/ada` is `401`; `/users` is
`401`. No redeploy.

### Add a human to Kit

1. `/agents/kit` → Users fold → tick Bob, or type an email for someone
   who is not on the app list yet (settings adds them as `member` on
   the same save). Settings writes `PENDANT_ALLOWED_USERS` in Kit's
   `config.env`. Env change **recreates** the container.
2. Kit boots, reads the list, dials, publishes `allow`. The DO stores
   it and indexes the email in KV.
3. Ada opens `/chat/kit` on her phone. `/api/auth/me` says
   `agents: ["kit"]`. First frame carries `user_id` + `email`; Kit
   matches the email and answers.
4. Kit's `perf` frame carries `user_id`. Spend shows a raw `1182…` next
   to Ada's email and offers to store it. Accept; the row becomes
   `sub:email`.

### Yank

1. Untick on Kit's Users fold. Recreate. Kit's dial publishes the
   shorter `allow`; the DO closes Ada's socket `4403`.
2. Remove from `/users` (or the env). Her next request anywhere is
   `401`; her cookie is worthless even though it has not expired.
3. Emergency (Kit down, cannot recreate now): Rotate bearer on
   `/agents/kit`. The room refuses the old harness; the phone has no
   one to talk to. Recreate when you can.
4. Stolen phone: OS lock, Google → sign out other sessions, then 2.

### Email change

The `sub` did not change. A `sub:email` row only needs a relabel. An
`email`-only row stops matching — update it. This is why settings
learns the `sub` when it can.

---

## What we gave up, and what we keep

The originals kept a passphrase on settings so the Mini would open
when `accounts.google.com` did not. gantree2 drops that on purpose.

| Concern | Now |
| --- | --- |
| Google down | Existing 7-day sessions keep working; new sign-ins wait. Status of a stopped agent is still readable with a live cookie. |
| Redirect URI at home | Google rejects LAN IPs. A home box needs Tailscale HTTPS or a Tunnel in front of celld. [install.md](install.md#home-celld). |
| First boot | No `/setup`. `GANTREE_ADMINS` in the env is the first admin. |
| Still a list | Yes. Google proves who; the list says whether; the role says what. |

Kept from the originals: the grammar, `sub` as the key, verified email
as an alias, fail closed, no enumeration, bearer per agent, the room
list as the agent's own policy.

---

## Threats

| Change | Risk | Why it is acceptable |
| --- | --- | --- |
| Harness names its own room's humans | Bearer holder can admit anyone to **that** room | The bearer already impersonates the harness and reads the queue. Kit's bearer still cannot touch Ada's slug. |
| Session for any verified Google account | Strangers hold a cookie | It opens nothing: the gate re-checks the list on every request. Same `unauthorized` for every miss; the only id shown is your own. |
| Email as alias | Someone else's Google account with that email? | Google verifies `email` on its own accounts. Exact, lowercased, `email_verified` required. Workspace `hd` is a later knob. |
| Room list remembered while the agent is down | Yank waits for a recreate | Removing the person from `/users` is instant for everything else. Bearer rotation is the instant room kill. |
| One IdP | Google outage blocks new logins | Sessions are 7 days; the originals' passphrase door is the escape hatch until Phase 4, after which an admin's live session is. |

What does **not** move: no inbound port on the harness, no Cloudflare
API token in settings, no MCP OAuth token doubling as a login, no role
in the cookie.

---

## Not this

| Shape | Why not |
| --- | --- |
| Passphrase or magic-link second door | Two doors is how the originals ended up with three ideas of a person. |
| Role in the cookie | Removal must be instant. The list is read every request. |
| Cloudflare Access in front of the Worker | 403s WebSocket upgrades; the harness is not a browser; a second identity system. |
| Pairing codes in chat | Lists, not handshakes. |
| Admins bypass the room list | Operating and talking are different grants. Kit's humans are Kit's list. |

## Fit gates

Fail one and the task is later, or wrong.

1. **One sign-in.** Google, PKCE, `jose`. Nothing else issues a session.
2. **One app list, one room list per agent.** Env floor ∪ Settings DO
   rows; `PENDANT_ALLOWED_USERS` on the Agent DO. No fourth copy.
3. **`sub` is the key, verified email is an alias.**
4. **Role every request, never from the cookie.**
5. **Fail closed.** No admins → `503`. Empty room list → nobody talks.
6. **No enumeration.** Same miss for everyone; you only ever see your
   own id.
7. **Isolation.** Adding a person to Kit does not touch Ada.
8. **Pull and dial, never punch.** `allow` rides the socket the harness
   already opened.

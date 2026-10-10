# gantree — one repo, one door, one product

> **gantree** — the tree. Harness at the root, agents on the branches,
> one place to talk to them and one place to run them. Logo: a tree.

This is the plan for building **gantree2** — a new sister repo at
`repos/gantree2` that folds **gantree** (today's settings console),
**gantry-pendant** (today's chat) and **ai-gantry** (the harness) into
one project that deploys to Cloudflare with `wrangler deploy` and to
home hardware with `celld deploy`, from the **same** `wrangler.jsonc`.

**Side by side, not a refactor.** The three original repos keep
running and are not edited for this. gantree2 grows next to them until
a stranger can do every walk in [phases](#phases) on gantree2 alone.
Then the originals get a pointer and an archive. The product name stays
`gantree`; `gantree2` is the checkout name while both exist.

This replaces the "Gantry2" Google Doc. Where that doc and this one
disagree, this one is right ([corrections](#corrections-to-the-gantry2-doc)).

The docs beside this one are the standalone set: [architecture.md](architecture.md)
(pictures, invariants), [access.md](access.md) (one person across
settings, chat, agent), [install.md](install.md), [custom-mcp.md](custom-mcp.md),
[mcp-naming.md](mcp-naming.md), [eval_setup.md](eval_setup.md),
[todo.md](todo.md). They were carried over from the originals and
rewritten for this product. **Two things change on purpose** and are
called out below: the settings door is Google, not a passphrase; and
files on a Docker host become rows on a Durable Object.

### Words

The originals used a shipping-yard vocabulary. gantree2 does not.

| Original | gantree2 |
| --- | --- |
| crane, gantry (instance) | **agent** |
| ai-gantry (the Go process) | **harness** |
| yard, board, console | **settings** |
| operators, humans, roster | **users** |
| pendant, mouth, `/talk` | **chat** — installable as a **PWA** |
| cab, helm | the native chat apps (repo names stay until Phase 4) |

Wire names the harness already reads (`CHANNEL=pendant`,
`PENDANT_ALLOWED_USERS`, `PENDANT_BEARER`) do not change in Phase 1–3.
They are called out as *wire names* where they appear.

---

## Why

People do not like three repos and a multi-face app. Fair. Today a
stranger needs: this checkout, a Worker deployed from a second checkout,
a Docker host, a passphrase for settings, a Google login for chat, a
Cloudflare API token pasted into Settings, and a third checkout to
read the harness. The *contract* between the pieces is good; the
*packaging* and the *number of doors* are the problem.

| Today | gantree2 |
| --- | --- |
| 3 repos, 3 CIs, 3 READMEs | 1 repo, 1 CI, 1 README |
| 2 logins (passphrase on settings, Google on chat) | **1 login: Google.** One allowlist for the whole app |
| Users created in `/setup`, rows in a sqlite on the Mini | Allowlist seeded from `.env` locally and GitHub Actions in the cloud; admins extend it in the UI |
| Settings on Node + `docker.sock`; chat on a Worker; harness in compose | One Worker project; harness is a container the Worker supervises |
| Settings pushes Worker secrets over the Cloudflare HTTP API | Settings and chat are the same Worker; a bearer is a storage write |
| MCP binaries fetched at runtime (`tools-fetch`, GitHub rate limits) | MCP binaries **baked into the harness image**; `mcp.toml` still toggles |
| Home = Docker on a Mini; cloud = VM + Tunnel | Home = `celld`; cloud = Cloudflare. Same manifest |

---

## Name

**gantree.** It is the one name in this family nothing else has.

Every dictionary word in the dock/crane/rigging family was checked on
2026-10-10 and is taken by a 2026 AI product: Bollard, Quay, Reeve,
Windlass (×3), Bosun, Hawser (×3), Derrick (Bosun's own tool), Davit,
Holdfast, Stanchion, Outrigger, Ballast (×4), Kedge (×3), Cleat, Abide,
Tenon, Yardarm. Plain `gantry` is taken three ways, including
`knacklabs/gantry` — a self-hosted agent runtime publishing
`@gantry/runtime` on npm — so **`gantry2` would sit next to a direct
competitor.** `vespr` collides with another AI company.

`gantree` already owns `github.com/shotah/gantree`,
`hub.docker.com/r/shotah/gantree` and `shotah.github.io/gantree`. Keep
them; point them at gantree2 at cutover. The native chat apps rename to
**gantree-cab** and **gantree-helm** in their own repos; their wire does
not change ([contract](#the-contract-does-not-move)).

---

## Shape

```text
                 one wrangler.jsonc  (repos/gantree2)
                 ┌─────────────────────────────────────────────┐
browser ───────► │  gantree Worker (Vinext on Workers)         │
phone  ────────► │   /login        Sign in with Google         │
  one door       │   /             agents (settings home)      │
                 │   /agents/<slug> one agent: run, tools, …   │
                 │   /users /settings /profile                 │
                 │   /chat/<slug>  chat (PWA)                  │
                 │   /ws/<slug>    socket (phone + harness)    │
                 │   /api/auth/*   google · callback · me · out│
                 │                                             │
                 │  Durable Objects                            │
                 │   Settings     users · audit · samples      │
                 │                (SQLite)                     │
                 │   Agent:<slug> config · allowlist · chat    │
                 │                room · bearer · alarm        │
                 │                · container                  │
                 │  KV   directory  sub:<sub> / email:<e> → slugs
                 │  R2   backups/<slug>/                       │
                 │  Cron planner tick → Agent alarm fan-out    │
                 └──────────────┬──────────────────────────────┘
                                │ Container binding (one per Agent DO)
                                ▼
                 ┌─────────────────────────────────────────────┐
                 │  harness image  (Go, distroless)            │
                 │   gantry binary + MCP binaries in /opt/mcp  │
                 │   dials wss://<origin>/ws/<slug> (bearer)   │
                 │   zero inbound ports                        │
                 └─────────────────────────────────────────────┘

wrangler deploy  → Cloudflare Workers + Durable Objects + Containers
celld deploy     → the same, on your Mini / VM (S3-compatible bucket for state)
```

Four things make this one product instead of three:

1. **One door.** Google signs you in. One allowlist says whether you
   may be here at all; a role says what you may touch in settings; an
   agent's own list says whether it will chat with you. Details:
   [auth](#auth-one-door).
2. **Settings and chat are the same Worker.** Minting a bearer, writing
   an agent's allowlist, rotating a secret — storage writes on the
   Agent DO. No Cloudflare API token in settings. No `CRANE_BEARERS`
   Worker secret. No `secrets:push`.
3. **The harness is a container the Agent DO supervises.** It does not
   become a Worker. The Go loop that was hardened on Gemma 12B stays
   Go. The DO starts it, passes its env, wakes it on alarm, and is the
   chat room it dials. Cloudflare Containers in the cloud; celld's
   container binding at home (Docker or Podman under the hood).
4. **One manifest, two targets.** celld runs the Workers platform —
   Workers, Durable Objects, KV, R2, D1, Queues, Workflows, Cron,
   static assets, Containers — from the `wrangler.json` you already
   have, and stops on any key it does not model. Anything we write that
   deploys to Cloudflare deploys to the Mini.

---

## Repo layout (`repos/gantree2`)

Nested under this checkout like the other siblings (`repos/*` is
gitignored here; gantree2 is its own git repo with its own remote).
TypeScript everywhere the harness is not. Vinext with the **legacy
Wrangler** init so the manifest is `wrangler.jsonc` (celld reads that;
it does not read `cloudflare.config.ts`). A custom `worker/index.ts`
is the Worker `main`: it re-exports Vinext's fetch handler and exports
the Durable Object classes.

```text
repos/gantree2/
├── app/                   Next-shaped UI (Vinext)
│   ├── login/             the one door
│   ├── api/auth/          google · callback/google · me · logout
│   ├── agents/[slug]/     one agent: run, tools, persona, secrets, log  — Phase 2
│   ├── chat/[slug]/       chat (PWA: manifest, service worker)         — Phase 2
│   ├── users/             admin: allowlist, roles, agent assignments
│   ├── settings/          admin: app settings
│   └── components/        shared/ agents/ chat/ users/ settings/
├── middleware.ts          auth gate for every route that is not public
├── worker/index.ts        main: Vinext handler + DO class exports
├── edge/                  Durable Objects + bindings
│   ├── settings.do.ts     users · audit · samples (SQLite)
│   ├── agent.do.ts        config · allowlist · chat room · bearer · alarm · container
│   └── directory.ts       KV sub/email → slugs
├── lib/
│   ├── door/              allowlist grammar · users · google · session · gate
│   └── contract/          frames · host-manifest · mcp.toml types (shared with cab/helm)
├── harness/               ai-gantry (Go) imported with history  — Phase 2
│   ├── Dockerfile         multi-stage: gantry + /opt/mcp/* from GoReleaser tarballs
│   └── mcp.lock           pinned MCP release tags baked into the image
├── test/                  mirrors app/ edge/ lib/ (never beside source)
├── wrangler.jsonc         the one deploy manifest
├── .dev.vars.example      local: Google client, session secret, allowlists
└── .github/workflows/     ci · deploy-cloudflare · harness-image · pages · release
```

Repo rules ([architecture.md](architecture.md#11-repo-rules)):
tests under `test/` mirroring source; UI folders by screen; import leaf
modules with `@/`; ESLint + `@stylistic`, no Prettier.

---

## Auth — one door

Settings had a passphrase door and chat had Google because the Mini
"must open when `accounts.google.com` does not." gantree2 drops that
invariant on purpose: **Google is the only login.** What we keep from
[access.md](access.md) is everything else — the grammar, `sub` as the
key, verified email as an alias, fail closed, no enumeration.

### Three questions, three lists

| Question | Answered by | Lives in |
| --- | --- | --- |
| May this Google account be here at all? | **app allowlist** (`GANTREE_ADMINS` ∪ `GANTREE_ALLOW` ∪ users added in the UI) | env floor + Settings DO |
| What may they touch in settings? | **role**: `admin` · `operator` (named agents) · `member` | env (admins) + Settings DO (assignments) |
| Will agent *Kit* chat with them? | **Kit's own list** (wire name `PENDANT_ALLOWED_USERS`, unchanged) | Agent:kit DO `config.env`, published as `allow` on dial |

A `member` can sign in and open `/chat/<slug>` for any agent whose
list has them. An `operator` additionally gets settings for their
agents. An `admin` gets everything: users, settings, every agent. Bob
can run Kit and never chat with her; Ada can chat with Kit from her
phone and never see settings. Same two populations as before; one
sign-in button.

### Entry grammar (unchanged)

Comma or whitespace separated. `118212345678901234567` (`sub`),
`118212345678901234567:ada@example.com` (`sub` with a label), or
`ada@example.com` (verified-email alias). `sub` is the key; email only
ever *matches* (exact, lowercased, `email_verified` required). Anything
else is dropped with a warning. This is `lib/door/allowlist.ts`; cab
and helm import the same code.

### Seeding — where the first users come from

The floor is environment. It is applied on **every** request, so you
cannot lock yourself out from the UI and a fresh deploy already knows
its admin.

| Where | How | Names |
| --- | --- | --- |
| Local (`vinext dev`, `celld dev`) | `.dev.vars` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `GANTREE_ADMINS`, `GANTREE_ALLOW`. Copy `.dev.vars.example`. Never committed. |
| Cloudflare (GitHub Actions) | **Variables** for things that are not secret; **secrets** for things that are | vars: `GOOGLE_CLIENT_ID`, `GANTREE_ADMINS`, `GANTREE_ALLOW`. secrets: `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. `deploy-cloudflare.yml` passes vars with `wrangler deploy --var` and secrets with `wrangler secret bulk`. |
| Home (`celld deploy`) | celld's `CELLD_VARS_FILE` (same shape as `.dev.vars`) or `CELLD_VAR_*` | Same five names. |

Rules:

- **Env is a floor, not a mirror.** Entries from env are always
  present and always admins/members as named. The UI shows them with a
  lock: "set in env". Removing one means editing env and redeploying.
- **Users added in the UI** (and operator assignments) live on the
  Settings DO. Removing a row there is immediate: role is evaluated on
  **every** gated request from env + DO, never trusted from the cookie.
- **Precedence:** admin in env > admin in DO > operator > member. An
  account on both lists is an admin.
- **Empty `GANTREE_ADMINS` fails the deploy** (CI check and a boot
  check that returns 503 "no admins"). Fail closed, same as an agent
  with an empty list.

### The flow

Authorization Code + PKCE, `openid email profile`, Google only.

1. `GET /login` — one button. `GET /api/auth/google?next=/agents/kit`
   mints `state`, `nonce`, `code_verifier`; seals them in a 10-minute
   `gantree_oauth` cookie (JWE); redirects to Google.
2. `GET /api/auth/callback/google?code&state` — checks `state` against
   the cookie, exchanges `code` (+ `code_verifier`) at
   `oauth2.googleapis.com/token`, verifies the ID token (`iss`, `aud`,
   `exp`, `nonce`, signature via Google JWKS — `jose`, not hand-rolled).
3. Allowlist check: `sub` on a list, **or** `email_verified` and the
   lowercased `email` on a list. Miss → one `unauthorized` page, the
   only identity shown is your own. No "not on the list for Kit"
   hints.
4. Hit → `gantree_session` cookie: JWE (`dir` + `A256GCM`, key =
   SHA-256 of `SESSION_SECRET`), claims `{ sub, email }`, **7-day hard
   expiry**, `HttpOnly; Secure; SameSite=Lax; Path=/` (`Secure`
   dropped only on loopback `http`). Redirect to `next`.
5. `middleware.ts` runs `lib/door/gate.ts` on every non-public route:
   open the cookie → compute role from env + DO → attach `x-gantree-*`
   headers for handlers. No cookie: navigations get `302 /login?next=`,
   `/api/*` gets `401 {"error":"unauthorized"}`. Public: `/login`,
   `/api/auth/google`, `/api/auth/callback/google`, static assets, the
   PWA manifest and service worker, `/_vinext/*`, `/.well-known/*`.
6. `GET /api/auth/me` → `{ sub, email, role, agents: [...] }` (cab and
   helm read this today as `cranes`; keep `cranes` as an alias until
   Phase 4). `POST /api/auth/logout` clears the cookie.

The socket `/ws/<slug>` keeps its two admissions: cookie for a phone
(plus that agent's room list), bearer for the harness. Unchanged.

### Google client, per place you run

gantree2 does not create the OAuth client. GCP → APIs & Services →
Credentials → OAuth client ID → **Web application**. Scopes `openid`,
`email`, `profile`. One client can carry every redirect below.

| Where | Authorized redirect URI |
| --- | --- |
| Local dev | `http://127.0.0.1:3000/api/auth/callback/google` (Google accepts loopback `http`) |
| Cloudflare | `https://<worker-origin>/api/auth/callback/google` |
| Home celld | `https://<mini>.<tailnet>.ts.net/api/auth/callback/google` or a Tunnel hostname. **Google rejects LAN IPs** (`http://192.168.x.x`), so a home box needs Tailscale HTTPS or a Tunnel in front of celld. [install.md](install.md#home-celld) covers both. |

### Dev without Google

`GANTREE_DEV_USER=118212345678901234567:you@example.com` in
`.dev.vars` fakes a signed-in session, **only** when the request host
is `127.0.0.1` / `localhost`. The gate refuses it on any other host.
Same shape and same rule as today's `GANTREE_DEV` loopback login.

### What we gave up, and what we keep

| Was | Now | Mitigation |
| --- | --- | --- |
| Settings opens with Google down | New logins fail while Google is down | Session is 7 days; a user who signed in this week still gets in. The harness keeps running regardless. |
| `/setup` first user with no cloud dependency | First admin is `GANTREE_ADMINS` in env | A fresh deploy is usable in one redeploy; no first-boot ceremony. |
| Passphrase hash, lockout buckets, `pass.ts` | Gone | Google carries 2FA, device prompts, session revocation. |
| User row (name, passphrase, email, chat ids, Google `sub`) | User row (`sub`, email, role, agents) — `sub` is the primary key | Telegram / Discord ids stay per-agent env, not on the person. |

---

## Users

Admins only. One page, `/users`.

| Action | What happens |
| --- | --- |
| Add a user | Type `email` or `sub:email`. Role `member` by default. Row on the Settings DO. They can sign in on the next try. |
| Make operator of Kit | Tick agents on their row. Stored on the Settings DO as `(sub-or-email, slug)`. `/agents/kit` opens for them on their next request. |
| Make admin | Toggle. Env-seeded admins show locked. |
| Put them on Kit's chat list | From Kit's page, tick the user (or type an email that is not a user at all). Writes `PENDANT_ALLOWED_USERS` (wire name) in Agent:kit `config.env`. Nags **recreate**. Same confirm-scary push as today. |
| Yank from Kit | Untick, recreate. Kit's dial publishes the shorter `allow`; the room closes their socket `4401`. Emergency with Kit down: rotate Kit's bearer. |
| Remove from the app | Delete the row. Next request: `401`. Their cookie is still valid JWE but the list says no. **Their entry may still be on agent lists** — the modal nags "ada is on Kit's list; untick and recreate." Isolation stays: no silent cross-agent edit. |
| Learn a `sub` | First turn logs `user_id` in `turn perf`. `/users` shows the raw `1182…` next to the email it matched and offers to store it. Accept → `sub:email` everywhere it is written. No one decodes a JWT in settings. |
| Email change | `sub` did not change. `sub:email` rows relabel; `email`-only rows stop matching until edited. This is why users learn the `sub`. |
| Stolen phone | OS lock → Google "sign out other sessions" → untick on each agent + recreate → rotate bearer if you cannot recreate now. |

Audit: every user write, chat-list push, bearer rotate, recreate is an
event on the Settings DO with the actor's `sub`. The event strip and
`jsonl` export carry over from today's console.

---

## Merging the interfaces

Two UIs become two surfaces of one app at one origin, behind one door,
and the plumbing between them disappears.

### Routes

| Route | Role | Comes from |
| --- | --- | --- |
| `/login`, `/api/auth/*` | public | new (`lib/door`) |
| `/`, `/agents/<slug>`, `/host`, `/boards` | operator (their agents) · admin | gantree `app/` |
| `/users`, `/settings` | admin | new + gantree Settings panes |
| `/profile` | any | gantree, minus passphrase change |
| `/chat`, `/chat/<slug>` | member+ on that agent's list | gantry-pendant UI, as a PWA |
| `/ws/<slug>` | cookie (phone) · bearer (harness) | gantry-pendant Worker → Agent DO |

### Shared shell

Settings and chat share: the tree, fonts, color tokens, `DoorShell`,
the avatar component, `lib/door`, `lib/contract`. They do **not** share
state stores or page code. Chat keeps its theme engine and backdrops,
ships a web manifest and service worker so it installs to a home
screen, and stays phone-first; settings stays desk-first. One header,
one logo, two surfaces.

### What dies

| Today | Why it goes |
| --- | --- |
| `/setup`, `/login` passphrase, `lib/yard/door/pass.ts`, lockout buckets, `operator_session` table | One door. |
| Settings → Pendant fold (CF token, account id, Worker name) | Same Worker. Nothing to push to. |
| `CRANE_BEARERS` Worker secret, Cloudflare Secrets HTTP API client | Bearer lives on the Agent DO. Rotate = storage write + socket close. |
| `GOOGLE_CLIENT_ID/SECRET`, `SESSION_SECRET` as *pushed* secrets | Deploy-time vars/secrets on the one project (table above). |
| `PENDANT_MAILBOX_URL` paste | It is `wss://<this origin>/ws/<slug>`. The Agent DO knows its own origin. |
| gantry-pendant CI, `secrets:push`, `npm run secret` | One CI. |
| `tools-fetch`, GitHub PAT in Settings, `/data/bin` prune | MCP bins are in the image. Catalog is `mcp.lock`. |
| `docker.sock`, dockerode, compose, `docker stats`, `docker logs` | Container binding + harness frames (below). |

### What the Agent DO holds (replaces files on disk)

Files were truth because settings ran on the Docker host. The Agent DO
is the same idea with a different disk: **one actor per agent, one
place to edit.** Settings edits it; the harness reads it at boot.

| Was | Now |
| --- | --- |
| `gantries/<slug>/.env` | `config.env` (SQLite row). Passed to the container as env at start. |
| `gantries/<slug>/mcp.toml` | `config.mcp` — same TOML text. Sent on the `config` frame. |
| `PERSONA.md`, `avatar.jpg` | `config.persona` on the DO; avatar in R2. |
| `PENDANT_ALLOWED_USERS` in `.env` (wire name) | Still a line in `config.env`. Still that agent's chat list. Harness still publishes `allow` on dial; DO stores it as the room list. |
| `PENDANT_BEARER` in `.env` (wire name) | `bearer` on the DO; also injected as env. Rotate writes both. |
| `gantree.toml` inventory | Settings DO table `agents`. Still no secrets in it. |
| `gantree.db` | Settings DO SQLite: users, assignments, audit, samples. |
| `data/gantry.db`, `SELF.md` | Container disk while running; **snapshot to R2** on a timer and on stop; restore on start. See [brain](#the-brain-gantrydb). |

Env change still **recreates**. Restart still keeps a ghost allowlist.
Same rule, same nag.

### How settings sees an agent (pull, don't punch)

| What | Was | Now |
| --- | --- | --- |
| Alive / image / restarts | `docker inspect` | Container binding state on the Agent DO |
| Turn / token graphs | parse `docker logs` for JSON slog `turn perf` | harness sends the same slog line as a `perf` frame; DO appends to Settings samples |
| Logs (per agent) | `docker logs` stream → SSE | harness mirrors slog over the socket at a bounded rate; DO fans out to the settings SSE. Workers Logs / celld tails as the long tail |
| CPU / RAM | `docker stats` | **gap on Cloudflare** — no per-container stats API. Show what the platform gives; do not add instrumentation to the harness |
| Published vs skipped MCP | `mcp.toml` + `gantry status` | `status` frame on connect (same JSON) |
| Data-dir size | `du` | size of the last R2 snapshot |

Frames are outbound on the connection the harness already opened. No
port, no scrape, no timer in the harness.

---

## Using celld

[celld](https://celld.dev/) ([denoland/celld](https://github.com/denoland/celld),
v0.4.0 as of Aug 2026) is an open-source daemon that runs a Cloudflare
Workers application on your own machines: Workers, Durable Objects, KV,
Queues, D1, R2, Workflows, Cron Triggers, static assets and, as an
experimental binding, Containers supervised by a Durable Object. It
deploys from the `wrangler.json` you already have, keeps each object's
state in its own SQLite, and replicates to an S3-compatible, GCS, or
Azure bucket you own. `celld dev` runs without Docker or a bucket.

Since 2026-10-09 celld belongs to Cloudflare (Deno acquisition) and is
being merged with workerd. Expect the project to move; the shape we
depend on — `wrangler.json` in, Workers + DOs + a container binding
out — is the shape Cloudflare bought it for.

| Question | Answer |
| --- | --- |
| Does the harness get rewritten? | **No.** The harness is an OCI image. The Agent DO's container binding starts it. `CELLD_DOCKER=docker` or `podman`; `CELLD_CONTAINER_RUNTIME=runsc` if you want gVisor at home. |
| Where does the Mini keep state? | A bucket. MinIO or Garage on the same box, or any S3 target. celld needs it for leases and durability. |
| Does "no open ports" still hold? | For the harness, yes — unchanged. The Worker listens, as the Node console does today. Put Tailscale HTTPS or a Tunnel in front (Google needs an HTTPS redirect anyway). |
| Daily planner, cron, watches? | The harness keeps its own clock while it runs. The Agent DO sets an **alarm** for the next planner tick so a sleeping container is woken. One clock, not two: the alarm only starts the box. |
| Containers are experimental in celld. | Yes. That is why Phase 2 is a canary beside a compose agent in the *original* gantree, and why the originals stay up until the walk passes twice. |
| Cloudflare Containers limits? | Ephemeral disk, per-instance CPU/RAM tiers, billed while running. The box sleeps between turns (`sleepAfter`); alarms wake it. The brain survives sleep because of the R2 snapshot. |

### The brain (`gantry.db`)

The one hard problem. Today `data/` is a bind mount. Containers on
Cloudflare have no durable disk; celld's container binding is a
supervised OCI container, not a volume manager.

Phase 2 answer, no harness storage rewrite:

1. On start the Agent DO hands the harness a presigned R2 GET for
   `backups/<slug>/latest.tar` on the `config` frame. The harness
   restores `gantry.db` + `SELF.md` if the file exists.
2. The harness already has a backup routine (today's backup button).
   Run it on a timer and on `SIGTERM`, PUT to a presigned R2 URL from
   the same frame.
3. Backup list / restore / prune are R2 listings. Restore = pick a
   stamp, recreate.

Later, if snapshot lag ever loses a turn that mattered: the harness
writes through to DO SQLite over the socket. That is a Go storage
change and is **not** Phase 2.

### MCP baked in

- `harness/mcp.lock` pins `{repo, tag, command}` for every catalog
  server (maps, math, image, pendant, strava, …).
- `harness/Dockerfile` fetches those tarballs at **build** time into
  `/opt/mcp/<id>/<id>` (one binary per plugin; a bare command resolves
  there). Distroless stays distroless.
- `host-manifest` still comes from the binary; the image Action runs it
  for every baked server and ships the shapes with the image.
- A custom server ([custom-mcp.md](custom-mcp.md)) is a row in
  `mcp.lock` and an image rebuild.
- OAuth hops (`auth_args`) are unchanged; tokens live in the agent's
  env / DO, never in the image.

Omit it from `mcp.toml` and it does not exist. That rule stands.

---

## The contract does not move

So cab, helm, and any agent running on the original stack keep working:

- Allowlist grammar — `sub`, `sub:email`, `email`.
- Frames `cmds`, `allow`, `msg`; new read-only `config`, `status`,
  `perf`, `log` are additive. A harness that never sends `perf` still
  works; settings just has no graph.
- `/ws/<slug>`: cookie for a phone, bearer for the harness. `4401` on miss.
- `/api/auth/me` → `{ sub, email, cranes[] }` (+ `role`, `agents[]`;
  `cranes` stays as an alias until Phase 4).
- Session id `pendant:<slug>:<sub>` (wire name).
- Fail closed both ends.

`lib/contract` is where all of it is typed and tested. Cab and helm
pin a version of it.

---

## GitHub Actions (gantree2)

| Workflow | On | Does |
| --- | --- | --- |
| `ci.yml` | push, PR | `npm ci` · `test:coverage` (thresholds in `vitest.config.ts`) · lint · typecheck · `vite build` · on `main`: write `badges/coverage.svg`, publish to `gh-pages` |
| `harness.yml` | push/PR touching `harness/**` | `go vet` + `go test -cover` in `harness/` **and every** `harness/mcp/*/go.mod`; `scripts/coverage-harness.sh` merges the profiles into one number; fails under `HARNESS_COVERAGE_MIN`; on `main`: `badges/harness-coverage.svg` → `gh-pages`. Skips cleanly until Phase 2 lands `harness/go.mod` |
| `deploy-cloudflare.yml` | after `ci` on `main`, or by hand | `vite build`; `wrangler deploy --var GOOGLE_CLIENT_ID:… --var GANTREE_ADMINS:… --var GANTREE_ALLOW:…`; `wrangler secret bulk` from `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`; fails fast if any of the four is empty |
| `harness-image.yml` | push to `harness/**` or `mcp.lock`, tag | Multi-stage image (gantry + `/opt/mcp`) → GHCR **and** the Cloudflare container registry; run `host-manifest` for every baked server; upload shapes |
| `eval.yml` | by hand, and called by `release.yml` | live-model behavior eval of the persona seed against the fixtures in `harness/internal/agent/testdata/eval/` ([eval_setup.md](eval_setup.md)); skips green without `LLM_API_KEY` or before `harness/go.mod` |
| `pages.yml` | push to `main` | docs site into `gh-pages` beside the badges |
| `release.yml` | tag `v*` | `needs: eval`; version bump, GitHub release, tagged harness image |

Home deploy is **not** an Action. `npm run deploy:home` runs
`celld deploy` on the Mini from the same manifest with
`CELLD_VARS_FILE`. GitHub cannot reach the Mini and should not.

### Coverage badges — front and center

Same shape as gantree and ai-gantry today, two numbers instead of one:

| Badge | Source | Threshold |
| --- | --- | --- |
| `coverage` | Vitest `json-summary` over `lib/**`, `edge/**`, `app/lib/**` | 60 / 60 / 60 / 60 in `vitest.config.ts` (floor; the number is ~95 today) |
| `harness coverage` | merged Go profile: `harness/` + `harness/mcp/*` | `HARNESS_COVERAGE_MIN=60` in `harness.yml` |

- Both SVGs are generated by `scripts/badge.mjs` (shields flat style;
  green ≥ 80, lime ≥ 60, olive ≥ 40, red below). It reads either a
  Vitest summary or a `go tool cover -func` dump.
- Both land under `badges/` on the `gh-pages` branch via
  `scripts/publish-pages.sh`, which only replaces the paths it is
  handed, so `ci.yml`, `harness.yml`, and `pages.yml` never erase each
  other. The three jobs share a `gh-pages` concurrency group.
- README links: `https://github.com/<owner>/gantree2/raw/gh-pages/badges/coverage.svg`
  and `…/badges/harness-coverage.svg`, in the badge row at the top.
- MCP plugins are **not** separate badges. An untested plugin lowers
  the harness number; that is the point of baking them in.

---

## Phases

Each phase ends with a walk a **stranger** can do on gantree2. The
original three repos are not touched; they keep serving the household
until Phase 4.

### Phase 1 — the door, in a new repo

- [x] `repos/gantree2`: Vinext (legacy Wrangler init → `wrangler.jsonc`),
      ESLint/`@stylistic`, Vitest, `test/` mirror, `ci.yml` with the
      coverage badge, `harness.yml` with the merged Go badge.
- [x] Pendant's theme system, whole: `lib/theme/{catalog,contrast,store}`,
      `app/lib/theme.ts` (`themeCss`, `THEME_BOOT`, paint/apply), the
      `ThemeSelect` picker, `globals.css` token map. Storage keys moved
      to `gantree.*`; the picker's tag reads the agent's name.
- [x] `lib/door`: allowlist grammar (lifted from `pendantShape`),
      users (env floor + store interface), Google (PKCE, token
      exchange, ID-token verify with `jose`), session (JWE cookie),
      gate (public paths, role, loopback dev user), `http` (start,
      callback, me, logout, guard as pure request → response). Tests
      for each; ~95 % lines.
- [x] `middleware.ts` + `/login` + `/api/auth/{google,callback/google,me,logout}`
      as one-line shells over `lib/door/http`. `vite build` passes.
- [x] `.dev.vars.example`, `deploy-cloudflare.yml` with vars/secrets
      as tabled above.
- [ ] `worker/index.ts` as `main` (needed once a DO class must be
      exported beside the Vinext handler).
- [ ] `wrangler.jsonc` with Settings DO declared; `UserStore` on the DO
      (SQLite) behind the same interface the env floor uses. Until
      then `lib/door/runtime.ts` hands the gate an empty store and
      `GANTREE_ADMINS` / `GANTREE_ALLOW` are the whole list.
- [ ] `/users` page (admin): list, add, role, assign agents, locked
      env rows.
- [ ] **Walk:** `npm ci`, copy `.dev.vars.example`, put your email in
      `GANTREE_ADMINS`, `npm run dev`, sign in with Google at
      `127.0.0.1:3000`. A second Google account gets `unauthorized`.
      Add it on `/users`; it gets in. Push to `main`; the Worker on
      Cloudflare does the same with Actions vars.

### Phase 2 — settings, chat, and an agent on the edge

- [ ] Import `gantry-pendant` UI into `app/chat` as a PWA, its Worker
      into `edge/agent.do.ts` (room, bearer, `allow`, `4401`s). Its
      Google door becomes `lib/door` (one implementation).
- [ ] Import gantree `app/` screens behind the role gate as `/agents`,
      `/settings`, `/host`, `/boards`. Docker-backed folds read the
      Agent DO instead of dockerode.
- [ ] Import `ai-gantry` to `harness/` with history. `mcp.lock` +
      multi-stage Dockerfile. `config` / `status` frames; snapshot on
      timer + `SIGTERM`. (Go changes; land in `harness/`.)
- [ ] Agent DO container binding starts the image with `config.env`.
      Harness dials its own origin.
- [ ] `wrangler deploy --dry-run` and `celld deploy` both accept the
      manifest.
- [ ] **Walk:** `wrangler deploy` to a fresh account. Sign in, build
      Kit, tick Ada. Ada signs in at `/chat`, installs the PWA, talks.
      Stop the box; alarm wakes it; Kit remembers. Then the same walk
      with `celld deploy` on a Mini with MinIO behind Tailscale HTTPS.

### Phase 3 — side by side

- [ ] Backup of a compose Kit (original gantree) → R2 → gantree2 Kit
      restores it. Memory, aims, cron all present.
- [ ] `perf` + `log` frames; graphs and per-agent log match the
      compose agent for a day.
- [ ] Access walks from [todo.md](todo.md) against the gantree2 agent:
      yank closes `4401`, rotate kills the old socket, stranger sees
      only their own id, removed user is `401` on the next request.
- [ ] Cab and helm connect to the new origin with no app change.
- [ ] **Walk:** two agents, one on each stack, same users, for a week.
      No regression.

### Phase 4 — cutover and rebrand

- [ ] Point the household origin at the gantree2 Worker.
- [ ] Tree logo on settings, chat, README, Docker Hub, github.io; cab
      and helm store assets; repos renamed `gantree-cab`, `gantree-helm`.
- [ ] Rename wire names (`PENDANT_*`, `CHANNEL=pendant`, `cranes` in
      `/api/auth/me`) in one coordinated harness + cab + helm release,
      or leave them. Decide then; nothing above depends on it.
- [ ] Originals: README pointer, archive. gantree2 takes the `gantree`
      GitHub name (rename, or transfer the Pages/Hub slots).
- [ ] **Walk:** stranger with **one** README stands up Kit for two
      users on Cloudflare, then on a Mini, yanks one, restores
      Thursday's stamp — and never sees a passphrase.

---

## Corrections to the Gantry2 doc

| Gantry2 doc says | Actually |
| --- | --- |
| "Ingest core agent logic from `gantree`" | The harness is `ai-gantry` (Go). `gantree` is settings. Import both; the harness keeps its language. |
| "Runs identically … via a single compiled Rust binary" | celld is the Rust binary. It runs **our JavaScript Worker** and supervises **our container**. We do not ship Rust. |
| "Each active agent session runs as a distinct Durable Object" | Chat rooms and agent supervision are DOs. The *harness loop* stays in the Go container. Porting the loop to a DO is a rewrite of the Completer, memory, cron and MCP client, and loses stdio MCP children. Not now; maybe never. |
| "Replaces OS-level cron loops with DO alarms" | DO alarms **wake** the box. The harness keeps its planner. Two clocks would violate "one daily planner". |
| "SQLite `.dump` into DO / D1" | Snapshot to R2 and restore on start. DO-SQLite write-through is a later Go change, not the migration path. |
| "Native iOS/iPad/Android clients" | Chat is a web app (PWA) on a Worker; cab and helm are the native siblings and they keep their wire. |
| "Decommission Docker" | Docker/Podman still runs the container under celld at home. What goes is compose, `docker.sock`, and dockerode in settings. |
| "Phase 1: initialize repo, ingest" (a refactor of the originals) | Phase 1 is the **door** in a new repo. Nothing moves until the door works in both places. Originals are untouched throughout. |

---

## Open questions

0. ~~**celld everywhere?**~~ **Decided (a): Cloudflare Workers +
   Containers in the cloud, celld at home.** Cloudflare acquired Deno
   on 2026-10-09 and is merging celld into workerd; the two
   implementations of the Workers platform become one. The manifest we
   already write is the one both will read. Deno Deploy (shutting down
   within six months) and the standalone Deno runtime (one year of
   patches) are not in our stack. Risk: celld's repo, binary name, or
   `deploy` flags may change mid-merge — pin the version in
   [install.md](install.md#home-celld) and treat `npm run deploy:home`
   as the single place that knows how to invoke it. Tracked in
   [todo.md](todo_done.md#0-decide).
1. **CPU/RAM graphs on Cloudflare.** No per-container stats API. Live
   without, or accept a tiny RSS sample in the harness's existing
   `turn perf` line. Default: live without.
2. **Logs transport.** Mirror slog over the socket (bounded) vs. rely on
   Workers Logs / celld tails. Default: socket for the live pane,
   platform logs for history.
3. **Bucket at home.** MinIO vs Garage on the Mini. Pick the one that
   runs as one binary.
4. **Snapshot cadence.** Timer + `SIGTERM` + after every N turns?
   Measure the tarball first.
5. **Workspace `hd` gate.** A household on one Google Workspace domain
   could skip the allowlist for members. Later knob; the list is the
   rule.
6. **Session length.** 7 days hard, no idle bump, matches today's chat.
   Long enough to ride out a Google outage? Decide after Phase 1 walk.

---

## Not this

- Rewriting the harness in TypeScript to "be a Durable Object".
- A second clock. The DO alarm starts the box; it does not plan.
- A second login. No passphrase fallback, no "log in with GitHub".
- A central user DB the harness reads. The agent's env is still its
  chat list.
- Cloudflare Access on `/ws`.
- ~~Hosted multi-tenant gantree. One household per deploy.~~ Flipped
  2026-10-10 — see [todo.md](todo.md#hosted-phase-5--the-paid-door).
  Still true for the migration itself: tenancy lands after cutover,
  not during it.
- Editing `gantree`, `gantry-pendant`, or `ai-gantry` for this
  migration. Side by side.
- Anything that makes the Go loop slower so a chart looks nicer.

Never sit in the token path.

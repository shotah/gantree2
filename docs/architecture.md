# Architecture

How gantree is put together: the pictures, then the choices that stay
true as it grows. The reasoning behind each shape is in
[proposal.md](proposal.md); who may do what is in [access.md](access.md);
where it runs is in [install.md](install.md). When this file and the
proposal disagree, fix both.

Vocabulary: **settings** (what operators see), **chat** (the PWA a
member talks through), **agents** (one Durable Object + one container
each), **harness** (the Go binary that is the agent), **users** (one
list, three roles). Wire names from the originals (`PENDANT_*`,
`CHANNEL=pendant`) survive until Phase 4 and are marked where they
appear.

## 1. The product

One Worker, one manifest, two places it runs.

```mermaid
flowchart LR
  subgraph people[" "]
    direction TB
    B[Browser<br/>operator]
    P[Phone<br/>member, PWA]
    C[Cab / Helm<br/>native]
  end

  subgraph worker["gantree Worker — wrangler.jsonc"]
    direction TB
    MW[middleware.ts<br/>one door]
    subgraph routes["Routes"]
      direction LR
      L["/login<br/>/api/auth/*"]
      S["/  /agents/:slug<br/>/users  /settings"]
      CH["/chat/:slug"]
      WS["/ws/:slug"]
    end
    subgraph dos["Durable Objects"]
      direction LR
      SDO[("Settings DO<br/>users · audit · samples<br/>SQLite")]
      ADO[("Agent:slug DO<br/>config · allowlist · room<br/>bearer · alarm · container")]
    end
    KV[("KV directory<br/>sub / email → slugs")]
    R2[("R2<br/>backups · boards · avatars")]
    CRON[Cron<br/>planner tick]
  end

  subgraph box["harness container — one per agent"]
    H[gantry binary<br/>Go, distroless]
    MCP["/opt/mcp/*<br/>baked MCP servers"]
    DB[("gantry.db · SELF.md<br/>container disk")]
    H --- MCP
    H --- DB
  end

  G[(Google<br/>OIDC)]

  B & P & C --> MW
  MW --> routes
  L <-.-> G
  S --> SDO
  S --> ADO
  CH --> ADO
  WS --> ADO
  MW --> SDO
  SDO --> KV
  ADO -- "Container binding<br/>start · env · stop" --> H
  H -- "wss /ws/:slug<br/>bearer" --> WS
  H -- "presigned PUT/GET" --> R2
  CRON --> ADO
  ADO -- avatars --> R2

  classDef store fill:#171d22,stroke:#3a4550,color:#f4f0ea
  class SDO,ADO,KV,R2,DB store
```

Two deploy targets, same picture:

```mermaid
flowchart LR
  M[wrangler.jsonc<br/>+ dist/]
  M -- "wrangler deploy<br/>(deploy-cloudflare.yml)" --> CF["Cloudflare<br/>Workers · DO · KV · R2<br/>Containers"]
  M -- "celld deploy<br/>(npm run deploy:home)" --> HOME["celld on the Mini<br/>same bindings<br/>Docker/Podman for containers<br/>S3 bucket for state"]
```

Where Docker went. The originals *operated* Docker: compose files,
`docker.sock`, bind mounts, `docker logs`. None of that exists here on
either target. On Cloudflare the Worker runs on Cloudflare's platform
and the harness on **Cloudflare Containers**. At home **celld** runs
that same platform, and for its container binding it drives Docker or
Podman underneath — an engine you install once and never address. One
OCI image, two supervisors; Docker survives only as celld's engine.

| | Cloudflare | Home |
| --- | --- | --- |
| Worker, DOs, KV, R2, Cron | Cloudflare | celld (SQLite + your S3 bucket) |
| Harness container supervisor | Cloudflare Containers | celld container binding |
| Container engine | Cloudflare's | Docker or Podman, under celld |
| What you type | `wrangler deploy` | `celld deploy` |

Why the languages stay where they are: the harness is Go because the
turn loop — parallel tool calls in one batch, the Completer round
discipline, RSS under small models — is the thing already proven, and
both supervisors run a static Go binary in a distroless image as well
as anything can be run. Rust would buy no user-visible speed (the token
path is the model) and would cost the sixteen Go plugins their shared
SDK. The Worker is TypeScript because Workers execute JS/Wasm, Vinext
and Durable Object classes are JS, and the backend is thin on purpose:
gate, DO storage, socket fan-out. There is no hot loop in it to move.

## 2. Request path — the door

Every non-public request passes `lib/door/gate.ts`. It is pure:
request + env + store in, decision out. `lib/door/http.ts` turns the
decision into a `Response`; `middleware.ts` is one line.

```mermaid
flowchart TD
  R([request]) --> PUB{public path?<br/>/login /api/auth/google<br/>/api/auth/callback/google<br/>assets · manifest · sw.js<br/>/_vinext /.well-known}
  PUB -- yes --> PASS([pass through])
  PUB -- no --> ADM{GANTREE_ADMINS<br/>parses to ≥1 entry?}
  ADM -- no --> E503([503 no admins])
  ADM -- yes --> DEV{GANTREE_DEV_USER set<br/>and host is loopback?}
  DEV -- yes --> ID[identity = dev user]
  DEV -- no --> CK{gantree_session<br/>cookie opens?}
  CK -- no --> API{"/api/* or /ws/*?"}
  API -- yes --> E401a([401 JSON])
  API -- no --> LOGIN([302 /login?next=path])
  CK -- yes --> ID
  ID --> RES["resolveUser(env floor ∪ Settings DO rows)<br/>highest role wins · operator agents unioned"]
  RES -- not on any list --> E401b([401 — a stale cookie is not a key])
  RES -- admin / operator / member --> HDR["x-gantree-sub · email · role · agents"]
  HDR --> PASS
```

Role, every request, never from the cookie:

| Source | Role | Locked |
| --- | --- | --- |
| `GANTREE_ADMINS` (env) | admin | yes — settings cannot remove |
| `GANTREE_ALLOW` (env) | member | yes |
| Settings DO `users` rows | admin / operator(agents) / member | no |

## 3. Sign-in — Google, PKCE, two cookies

```mermaid
sequenceDiagram
  autonumber
  actor U as Person
  participant W as Worker<br/>lib/door/http.ts
  participant G as Google<br/>accounts.google.com
  participant T as Google<br/>oauth2.googleapis.com
  participant S as Settings DO<br/>(UserStore)

  U->>W: GET /agents/kit (no cookie)
  W-->>U: 302 /login?next=/agents/kit
  U->>W: GET /login
  W-->>U: page: "Continue with Google"
  U->>W: GET /api/auth/google?next=/agents/kit
  Note over W: state, nonce, code_verifier<br/>sealed in gantree_oauth (JWE, 10 min)
  W-->>U: 302 accounts.google.com/o/oauth2/v2/auth<br/>Set-Cookie: gantree_oauth
  U->>G: authorize (openid email profile, S256 challenge)
  G-->>U: 302 /api/auth/callback/google?code&state
  U->>W: GET /api/auth/callback/google (gantree_oauth)
  W->>W: open gantree_oauth · state must match
  W->>T: POST /token {code, code_verifier, client_secret}
  T-->>W: {id_token}
  W->>W: jose.jwtVerify: iss · aud · exp · sig (JWKS) · nonce
  W->>S: list()
  S-->>W: rows
  W->>W: resolveUser(env floor ∪ rows, {sub, email, email_verified})
  alt on a list
    Note over W: gantree_session = JWE {sub, email}<br/>7-day hard expiry, HttpOnly Secure Lax
    W-->>U: 302 /agents/kit<br/>Set-Cookie: gantree_session · clear gantree_oauth
  else not on any list
    W-->>U: 302 /login?error=not_allowed<br/>clear gantree_oauth · no session
  end
```

Every miss (`expired`, `state`, `exchange`, `token`, `not_allowed`)
bounces to `/login?error=` and never sets a session. The only identity
a stranger ever sees is their own.

## 4. Chat — phone to harness through the Agent DO

The Agent DO is the room. A phone joins with a cookie plus that agent's
own list; the harness joins with a bearer. Neither side knows the
other's address.

```mermaid
sequenceDiagram
  autonumber
  actor M as Member (PWA)
  participant MW as middleware
  participant A as Agent:kit DO
  participant H as harness (container)

  Note over H,A: on container start
  H->>A: wss /ws/kit  Authorization: Bearer <PENDANT_BEARER>
  A->>A: bearer matches DO row
  H->>A: allow {PENDANT_ALLOWED_USERS}
  A->>A: room list ← allow
  A->>H: config {env, mcp.toml, persona, R2 presigned GET/PUT}
  H->>A: status {published, skipped MCP}

  Note over M,A: a person opens the chat
  M->>MW: GET /chat/kit (gantree_session)
  MW->>MW: gate → pass (member)
  MW-->>M: PWA shell
  M->>A: wss /ws/kit (cookie)
  A->>A: open cookie · sub/email on the room list?
  alt on the room list
    A-->>M: joined · theme · backlog
  else not
    A-->>M: close 4403
  end

  M->>A: message {text, images?}
  A->>H: message
  H->>H: turn (model · MCP tools · gantry.db)
  H->>A: reply {text}
  A-->>M: reply
  opt agent sets the mood
    H->>A: theme {id}
    A-->>M: {kind: "theme", theme: "siren"}
    Note over M: paint unless the person pinned their own
  end
  H->>A: perf {turn, tokens}  (slog line as a frame)
  A->>A: append to Settings samples
```

## 5. Agent lifecycle — the DO supervises the container

```mermaid
stateDiagram-v2
  [*] --> Stopped
  Stopped --> Starting : operator Start<br/>or Cron tick with work
  Starting --> Restoring : container up<br/>harness dials /ws
  Restoring --> Running : R2 latest.tar restored<br/>(or none — fresh brain)
  Running --> Running : turns · alarm wakes · perf/log frames
  Running --> Snapshotting : timer · SIGTERM
  Snapshotting --> Running : PUT backups/kit/<stamp>.tar
  Snapshotting --> Stopped : was stopping
  Running --> Recreating : operator edits config.env
  Recreating --> Starting : new env → new container
  Running --> Stopped : crash → DO notes restart count
  Stopped --> [*]

  note right of Restoring
    Container disk is not durable.
    gantry.db lives in R2 between runs.
  end note
```

```mermaid
sequenceDiagram
  autonumber
  actor O as Operator
  participant W as Worker /agents/kit
  participant A as Agent:kit DO
  participant C as Container binding
  participant H as harness
  participant R as R2

  O->>W: POST start
  W->>A: start()
  A->>A: read config.env · bearer
  A->>C: start(image, env)
  C-->>A: running
  H->>A: dial /ws/kit (bearer)
  A->>H: config {…, restore: presigned GET latest.tar}
  H->>R: GET latest.tar
  R-->>H: tar (or 404)
  H->>A: status
  A-->>W: alive · image · status
  W-->>O: card turns green

  loop every N minutes and on SIGTERM
    H->>R: PUT backups/kit/<stamp>.tar (presigned)
    H->>A: snapshot {stamp, bytes}
  end

  O->>W: edit config.env
  W->>A: write config.env
  A->>C: stop
  A->>C: start(image, new env)
  Note over A,H: "env change recreates" — same rule as Docker
```

## 6. Users — one list, three roles

```mermaid
flowchart LR
  subgraph floor["env floor (locked, every request)"]
    AD["GANTREE_ADMINS<br/>admin"]
    AL["GANTREE_ALLOW<br/>member"]
  end
  subgraph store["Settings DO · users"]
    ROWS["rows: entry · role · agents[] "]
  end
  subgraph agent["Agent:kit DO"]
    ROOM["room list<br/>(PENDANT_ALLOWED_USERS)"]
  end

  floor --> RES
  store --> RES
  RES["resolveUser(who)"] --> ROLE{{"admin · operator(agents) · member · none"}}
  ROLE -- "/users /settings" --> ADMIN[admin only]
  ROLE -- "/agents/:slug" --> OP["admin, or operator with slug in agents[]"]
  ROLE -- "/chat/:slug" --> CHAT["any role, and on the room list"]
  ROOM --> CHAT
```

Seeding, by place:

| Where | `GANTREE_ADMINS` / `GANTREE_ALLOW` / `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_SECRET` / `SESSION_SECRET` |
| --- | --- | --- |
| Local | `.dev.vars` | `.dev.vars` |
| Cloudflare | Actions **variables** → `wrangler deploy --var` | Actions **secrets** → `wrangler secret bulk` |
| Home | `CELLD_VARS_FILE` | `CELLD_VARS_FILE` |

## 7. Build and ship

```mermaid
flowchart LR
  subgraph ci["ci.yml — push, PR"]
    direction LR
    T[test:coverage<br/>thresholds] --> LNT[lint] --> TC[typecheck] --> BLD[vite build]
    BLD -- main --> BADGE[badge.mjs vitest] --> PUB1[publish-pages.sh<br/>badges/coverage.svg]
  end
  subgraph hz["harness.yml — harness/**"]
    direction LR
    GT["go vet + go test -cover<br/>harness/ and harness/mcp/*"] --> MERGE[coverage-harness.sh<br/>one profile, one total] --> MIN{≥ HARNESS_COVERAGE_MIN}
    MIN -- main --> BADGE2[badge.mjs gofunc] --> PUB2[publish-pages.sh<br/>badges/harness-coverage.svg]
  end
  subgraph dep["deploy-cloudflare.yml — after ci on main"]
    direction LR
    V[vite build] --> CHK{vars + secrets<br/>all set?} --> WD[wrangler deploy --var …] --> SB[wrangler secret bulk]
  end
  subgraph img["harness-image.yml — harness/** · mcp.lock · tag"]
    direction LR
    LOCK[mcp.lock] --> DOCK[Dockerfile<br/>fetch tarballs → /opt/mcp] --> MAN[host-manifest<br/>per baked server] --> REG[GHCR + Cloudflare registry]
  end
  ci --> dep
  PUB1 & PUB2 --> GH[("gh-pages<br/>badges/ · site")]
  GH --> README[README badge row]
```

`publish-pages.sh` replaces only the paths it is handed; the three
writers share one concurrency group. Home deploy is a human running
`npm run deploy:home`; GitHub cannot reach the Mini.

## 8. Code map

```mermaid
flowchart TB
  subgraph app["app/ — thin shells"]
    LAYOUT[layout.tsx<br/>themeCss · THEME_BOOT]
    PAGES["login/ · page.tsx<br/>agents/ · chat/ · users/ (next)"]
    API["api/auth/*/route.ts<br/>one line each"]
    ALIB["app/lib<br/>theme · prefs · login"]
    COMP["app/components/shared<br/>ThemeSelect"]
  end
  subgraph door["lib/door — pure, tested"]
    ALLOW[allowlist] --> USERS[users] --> GATE[gate] --> HTTP[http]
    GOOGLE[google] --> HTTP
    SESSION[session] --> GATE
    SESSION --> HTTP
    RT["runtime<br/>(cloudflare:workers only here)"]
  end
  subgraph theme["lib/theme — from pendant"]
    CAT[catalog · 15 themes] --> CON[contrast gate]
    CAT --> STORE[store · wire notice]
  end
  subgraph edge["edge/ — Durable Objects (Phase 1–2)"]
    SDO[settings.do.ts]
    ADO[agent.do.ts]
    DIR[directory.ts]
  end
  MW[middleware.ts] --> HTTP
  MW --> RT
  API --> HTTP
  API --> RT
  RT -.-> SDO
  LAYOUT --> ALIB --> CAT
  COMP --> ALIB
  TEST["test/ mirrors every folder"] -.-> door & theme & ALIB & edge
```

Coverage counts `lib/**`, `edge/**`, `app/lib/**`. `lib/door/runtime.ts`
is the one excluded file: it imports `cloudflare:workers` and has
nothing to assert.

---

## 9. Why this shape

**One Worker, not three repos.** The originals were a Node console on
the Docker host, a Worker for the phone, and a Go harness in a
container — three ideas of a person and three READMEs. Here settings
and chat are one Vinext app on Workers, state is Durable Objects
instead of files on a host, and the harness is a container the Agent
DO supervises. Cloudflare Containers in the cloud; celld's container
binding at home.

**Why the harness stays Go, in a container.** The loop that was
hardened on small models — parallel tool calls, Completer rounds, RSS
discipline — is Go and stays Go. It does not become a Worker. The DO
starts it, passes its env, wakes it on alarm, and is the room it dials.

**Why Durable Objects, not D1.** One actor per agent is the natural
unit: its config, its room, its bearer, its alarm, its container
handle. Settings is one more actor. Nothing is shared except the KV
directory and R2.

**Why a brain in R2.** Container disk is not durable on either target.
`gantry.db` + `SELF.md` snapshot to R2 on a timer and on stop, restore
on start, via presigned URLs on the `config` frame. The harness's
storage code does not change.

## 10. Choices that stay true

If a task fails one of these, it is later, or it is wrong.

1. **One door.** Google signs you in; one list says whether; a role
   says what; each agent's room list says who it talks to. Role is
   computed every request, never read from the cookie. No second
   login. [access.md](access.md).
2. **The Agent DO is truth.** `config.env`, `config.mcp`, persona,
   allowlist, bearer live on the DO. Settings edits them; the harness
   reads them at boot. No file on a host, no second inventory.
3. **Pull, don't punch.** The harness is outbound-only. No `/metrics`
   port, no scrape, no hook. `status`, `perf`, `log`, `allow`,
   `snapshot` ride the socket it already opened. If a settings want
   would make the harness slower, the want is wrong.
4. **One mutation path.** Route handlers call `lib/door` and the DO
   stubs. Never storage from a React Server Component. Pages stay thin
   shells.
5. **One manifest, two targets.** Anything that deploys to Cloudflare
   deploys under celld. celld stops on a key it does not model; that
   is the check.
6. **One language in this repo, two in the product.** TypeScript here.
   Go in `harness/` and `harness/mcp/*`. No `gantree` CLI until `npm`
   scripts are genuinely not enough — still TypeScript.
7. **Isolation.** One human list per agent, one DO, one container, one
   R2 prefix. Retire a tryout = delete its DO and prefix. Adding a
   person to Kit does not touch Ada.
8. **Env change recreates.** Same rule as Docker. Restart keeps a
   ghost allowlist; the UI nags.
9. **Not chat.** Settings never sits in a chat turn. Chat is a PWA on
   the same origin, not a feature of the settings screens.
10. **MCP is baked in.** `harness/mcp.lock` → image. Omit a server from
    an agent's `config.mcp` and it does not exist for that agent. No
    download at agent start. [custom-mcp.md](custom-mcp.md).
11. **Estimates stay estimates.** Spend is `perf` tokens plus an
    optional pasted $/1M. Not an invoice. `unknown` is a first-class
    slice.
12. **Import over write.** `jose` for JWE/JWKS, Vinext for the app,
    wrangler and celld for deploy. Do not invent a Docker client, a
    JWT parser, or a theme engine.
13. **Coverage is a badge, not a hope.** Two numbers on the README.
    Thresholds in `vitest.config.ts` and `HARNESS_COVERAGE_MIN` only
    go up.

## 11. Repo rules

- Tests live under `test/` and mirror the module they cover
  (`lib/door/gate.ts` → `test/door/gate.test.ts`,
  `app/components/shared/ThemeSelect.tsx` →
  `test/app/components/shared/ThemeSelect.test.tsx`). Never beside
  source.
- Import with `@/`. Import leaf modules, not barrels.
- UI folders match screens (`shared`, `agents`, `chat`, `users`,
  `settings`), not widget types. No `src/` wrap, no atoms/molecules.
- `cloudflare:workers` is imported in exactly one place per concern
  (`lib/door/runtime.ts`, later `edge/*.do.ts`). Everything else is
  plain TypeScript Vitest can run.
- ESLint + `@stylistic` is the style. No Prettier. Do not disable
  `no-explicit-any`; type it or delete the dead write.
- Wire names from the originals (`PENDANT_*`, `CHANNEL=pendant`,
  `cranes` on `/api/auth/me`, `pendant:<slug>:<sub>`) stay until
  Phase 4 so cab, helm, and agents on the old stack keep working.
  They are marked as wire names wherever they appear.

## 12. Later, and not the product

**Later** (when a real gap forces it): Workspace `hd` gate; saved
watches and a tile catalog after one attention surface stops being
enough; provider billing pull; harness write-through to DO SQLite;
operator writes on boards. List: [todo.md](todo.md#later).

**Not the product:** hosted SaaS, Kubernetes, Cloud Run / Lambda, a
shared family brain, pairing the agent through settings, multi-tenant
orgs, invite links, billing, a second login, Cloudflare Access in
front of the Worker, anything that makes the harness slower so a
dashboard looks nicer.

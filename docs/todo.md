# Work

The plan is [proposal.md](proposal.md); the pictures are
[architecture.md](architecture.md); what has shipped is
[todo_done.md](todo_done.md) (same section numbers, so "§5" means the
same thing in both). This is what is left, in the order to do it.

**State today (2026-10-10):** every screen, the door, the chat PWA,
the agent registry, the harness with twelve plugins, the mark, the
docs site on `github.bldhosting.com`, release tooling. Kit answers
through `npm run agent` and files tasks and goals from chat. Vitest,
type-aware ESLint, `tsc`, and the Go gate are green; CI is green so
`deploy-cloudflare` runs on the next push. **Not yet done:** a real
Google sign-in on the laptop, the first Cloudflare deploy, and a
stranger's walk from the README.

Legend: `[ ]` open · **owner** needs a human with a console · tags are
`easy` / `medium` / `hard` for effort. Each list is ordered easiest
first. Decisions (**D**) that are settled live in
[todo_done.md](todo_done.md#0-decide); the one still open is hosted
pricing, in the Hosted section.

---

## Now — blocks the first deploy or the first stranger

- [ ] **owner · easy** Real Google sign-in on the laptop (§1). Google
      has **no wildcard**: the Web client must list the exact string
      `http://127.0.0.1:3000/api/auth/callback/google` under Authorized
      redirect URIs (`http` only for loopback hosts; no `127.*`, no
      port range). The Worker builds `redirect_uri` from the request
      origin (`lib/door/http.ts` → `redirectUri(url.origin)`), so the
      browser must be on `127.0.0.1:3000`, not `localhost:3000` — or
      register both. A mismatch shows Google's `redirect_uri_mismatch`
      page, not ours.
- [ ] **owner · easy** Provider consoles for the tools (§7): the
      **tools** Google client lists `https://github.bldhosting.com/oauth-catch/`
      as a redirect; Strava's Authorization Callback Domain is
      `github.bldhosting.com`; Google Health's client likewise; the
      consent screen's privacy URL is `https://github.bldhosting.com/privacy/`.
      Proof is a `/auth google` round trip in chat that lands a token.
- [ ] **owner · easy** `deploy-cloudflare.yml` first run (§8). CI is
      green and the workflow now provisions KV + R2 itself; it needs
      `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets and the
      `vars` it reads (`GOOGLE_CLIENT_ID`, `GANTREE_ADMINS`,
      `GANTREE_ALLOW`, `VAPID_SUBJECT`). Then `https://gantree2.bldhosting.com`
      resolves.
- [ ] **owner · easy** Walk: add Bob on `/users`; he gets in; remove;
      `401` next click (§2).
- [ ] **owner · medium** Walk: build Kit on `/agents/new`; grant maps;
      put the key in; Kit's card goes green; Kit's log fold streams
      (§4). Half walked: Kit talks through `npm run agent`; the
      container path is the open half.
- [ ] **owner · medium** Walk: Agent DO starts the image; harness
      dials with the DO's bearer; `status` lists published MCP;
      `snapshot` lands in R2 (§5). Needs the deploy above and the GHCR
      image (`harness-image.yml` pushes on `main`; not run yet).
- [ ] **owner · hard** Walk: a stranger with **one** README stands up
      Kit for two humans, yanks one, never opens the Cloudflare
      dashboard after the token (§8). The last box.

## Next — ship quality

- [ ] **easy** GHCR image name `gantree-harness`; Docker Hub
      description only if we keep publishing there (§7).
- [ ] **easy** Raise `HARNESS_COVERAGE_MIN` (§6): garmin went 33 % →
      63 %, so re-run `scripts/coverage-harness.sh` and lift the floor
      from 69 to whatever the merged number is, minus a point.
- [ ] **medium** Eval fixtures + `mcp.toml` → `harness/internal/agent/
      testdata/eval/`; `tools_from` builds the sibling plugin, no
      release fetch. `eval.yml` turns real (§5). Then release gets
      `needs: eval` before tagging and a `vX.Y.Z`-tagged harness image
      (`harness-image.yml` publishes on push only) (§8).
- [ ] **medium** Walk: `tools/list` from the image matches the Tools
      grid; the eval's catalog-drift check passes on every `tools_from`
      server (§6).
- [ ] **medium** Chat pitch (carried): one multi-step turn with tool
      trace from a real agent on this stack, for the README. Needs the
      provider consoles above.
- [ ] **hard** Backup is a loop (carried). Stamps already land under
      `backups/<slug>/<stamp>/` beside `latest/`; nothing lists them.
      Add: list stamps, restore = pick a stamp then recreate, prune =
      keep last N or retain days (admin, confirm-scary). The harness
      only ever PUTs the named snapshot files, so `.env` / `mcp.toml`
      never enter a stamp; the token tar is encrypted — keep both true
      in a test when the listing lands.

## Then — side by side, cutover (§9)

- [ ] Backup of a compose Kit → R2 → gantree2 Kit remembers.
- [ ] Two agents, one per stack, same users, one week.
- [ ] Cab and helm on the new origin, no app change.
- [ ] Flip the wire aliases from §0 (`cranes`, `CHANNEL=pendant`,
      `PENDANT_*`). Drop `cranes`.
- [ ] Originals: README pointer, archive. gantree2 takes the `gantree`
      name.

## Hosted (Phase 5) — the paid door

**D — decided 2026-10-10:** gantree is a hosted product as well as a
self-hosted one. v1 (one household per deploy) was never durable
enough to sell; v2 on Workers + Containers with celld converging on
workerd is. Self-hosting stays first-class and free; the hosted door
is the same code with a tenant key. Pitch, prices, and the cost of one
hosted agent: [monetize.md](monetize.md). Nothing below starts before
the cutover in §9 — a hosted customer cannot be the first stranger.

Ordered: the free, legal, and architectural prerequisites, then the
product.

- [ ] **owner · easy** License. No `LICENSE` file exists (the README
      badge points at one). Pick MIT or Apache-2.0 and commit it. Open
      is how a stranger trusts the door with their Gmail; the money is
      in hosting and time, not the code.
- [ ] **easy** `FUNDING.yml` + a Support line in the README and the
      site footer (GitHub Sponsors; one tip jar, not five).
- [ ] **owner · medium** The entity: LLC in your state, registered
      agent, business bank account, EIN; a merchant of record (Lemon
      Squeezy / Paddle / Polar.sh) so sales tax and VAT are theirs.
      Needed before the first paid sign-up, not before.
- [ ] **owner · medium** Paper: Terms of Service and a hosted privacy
      policy (the Pages one covers the OAuth catch page only). Say
      plainly what the Agent DO holds (the LLM key they paste; the key
      that decrypts their token snapshot) and that tool OAuth clients
      are theirs.
- [ ] **hard** Tenancy. Today one Settings DO is `idFromName(
      "settings")` and Agent / Harness DOs are `idFromName(slug)` —
      one household per deploy. Hosted needs a household id: Settings
      DO per household, Agent and Harness DOs named `<household>/<slug>`,
      `/chat/<slug>` and `/agents/<slug>` resolved through the signed-in
      principal's household (KV `DIRECTORY` already maps people to
      rooms), slugs unique per household not per deploy. Self-hosted is
      the degenerate case: one household, id `settings`, no behaviour
      change. Tests on every route.
- [ ] **medium** Sign-up. A Google account that is on no list today
      lands on `/login?error=not_allowed`; hosted turns that into
      "start a household": a new Settings DO with this person as
      admin, zero agents, a plan row. Same gate code; one new branch.
- [ ] **medium** Billing hook. The merchant of record's webhook →
      `POST /api/billing/<provider>` (signature checked) → writes the
      household's plan row: agents allowed, state (`trial` /
      `active` / `past_due` / `cancelled`). `NewAgent` and the Harness
      DO refuse past the cap; `past_due` stops containers after a
      grace period, never deletes the snapshot. No card data ever
      touches the Worker.
- [ ] **medium** Hosted guardrails: `max_instances` real, instance
      type pinned to `lite`, custom manifests off, per-household
      container cap, `/users` add limited by plan, the `home_only`
      flag hiding anything LAN.
- [ ] **medium** Landing. The Pages home gets a price and a "Start"
      button that lands on the hosted Google door; `/login` on the
      hosted origin says what you are signing up for. One page, one
      price, the self-host link still above the fold.
- [ ] **owner · medium** Google brand verification for the hosted
      sign-in client (`openid email profile` only — no assessment);
      the privacy URL above; the consent screen carries the business
      name.
- [ ] **medium** Guided setup for the tools — `/auth google` in chat
      is the only OAuth a hosted customer does, but they still need a
      GCP project and a client. A wizard step with the five console
      clicks and a paste box, checked live (the redirect must be
      `https://github.bldhosting.com/oauth-catch/`). This is also the
      free "set it up with me" product from monetize.md Path 1.
- [ ] **owner · easy** Price: $8–10 a month for one agent, $3–4 per
      extra agent on the household, 14-day trial, no one-time tier
      (containers bill monthly). Revisit with the first ten.
- [ ] **hard** Walk: a stranger pays, signs in, builds Kit, pastes an
      LLM key, chats; cancels; the container stops; the snapshot is
      still in R2 for 30 days; `/login` says so.

## Later

- Navigation uses `window.location.assign` (full reloads) — swap for
  the router once the walks are done (§4).
- Compare fold (carried): 2–3 agents, overlay tokens. `/` is a router
  now, so it lives on `/settings` Spend or `/agents`; logs stay per
  agent.
- Per-person spend (carried): samples carry `agent`, `kind`, `value`
  — no `user_id` — so "sub → display name" has nothing to name yet.
  Add a `who` column from the `perf` frame's `source` first.
- Chat screen restyle: `PhoneShell` was not touched by the console
  restyle; the Cab shot the owner likes has a backdrop and an avatar,
  which the web chat supports but the seed does not set (§7).
- Web push walk: needs VAPID keys in `.dev.vars` (§3).
- Workspace `hd` gate on sign-in.
- Saved watches / tile catalog — after one attention surface stops
  being enough.
- Provider billing pull. Spend is tokens plus a pasted rate.
- Harness write-through to DO SQLite — only if snapshot lag ever loses
  a turn.
- Operator writes on boards.
- A `gantree` CLI only if `npm` scripts are not enough — TypeScript.

## Other checkouts

Not this repo; listed so they are not forgotten.

- `gantree2-apps`: cab/helm shots on emulators and the stolen-phone
  paragraph's three pictures; store listing text; wiring the brand
  PNGs from `shared/brand/`; cab/helm wording of the stolen-phone
  paragraph matching [access.md](access.md).

## Not this product

- Kubernetes; Cloud Run / Lambda / App Runner — Workers + Containers
  hosted, celld at home, nothing else
- Shared family brain — one agent's memory is one agent's
- Pairing the agent through settings; pairing codes in chat
- Reselling LLM tokens — bring your key, even on the hosted door
- A shared Google client for the tools — BYO client, hosted or not
- Invite links and orgs beyond one household per account
- A second login (passphrase, magic link, SSO beyond Google)
- Cloudflare Access in front of the Worker
- Role in the cookie
- MCP OAuth as a phone login
- Anything that makes the harness slower so a dashboard looks nicer

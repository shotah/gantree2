# Work

The plan is [proposal.md](proposal.md); the pictures are
[architecture.md](architecture.md); what has shipped is
[todo_done.md](todo_done.md) (same section numbers, so "§5" means the
same thing in both). This is what is left, in the order to do it.

**State today (2026-10-11):** every screen, the door, the chat PWA,
the agent registry, the mark, the docs site on
`github.bldhosting.com`, release tooling. The Workers-native brain
is the only runtime ([todo_done.md](todo_done.md) §10). There is no
harness directory and no container. `wrangler.jsonc` is Settings
and Agent (SQLite) plus KV `DIRECTORY`. The catalog is
`toolCatalog()` from `brain/plugins`. `npm run agent` is a local
REPL on `createBrain`. Live eval is 30/30. `package.json` is
0.2.15. Kit files tasks and goals from chat. Phones can sign in
without a browser (`/api/auth/{config,nonce,token}`). A file count
while this note was written was 280 test files. The reported gate
was 279 files / 1945 tests, eslint, tsc, and the build clean. This
note did not re-run the suite. **Not yet done:** the GitHub ruleset
and labels, the provider-console redirects, the first deploy and
the walks, the CodeQL-to-eslint pass, and the owner's release of
0.2.15.

Legend: `[ ]` open · **owner** needs a human with a console · tags are
`easy` / `medium` / `hard` for effort. Each list is ordered easiest
first. Decisions (**D**) that are settled live in
[todo_done.md](todo_done.md#0-decide); the one still open is hosted
pricing, in the Hosted section.

---

## Now — blocks the first deploy or the first stranger

- [ ] **owner · easy** Provider consoles for the tools (§7): the
      **tools** Google client, Strava, and Google Health list
      `https://gantree2.bldhosting.com/api/auth/catch` and
      `http://127.0.0.1:3000/api/auth/catch` as redirects. The
      consent screen's privacy URL is
      `https://github.bldhosting.com/privacy/`. Proof is a
      `/auth google` round trip in chat that lands a token.
- [ ] **owner · easy** Owner clicks in [ci.md](ci.md): the seven
      labels and the `main` ruleset (pull request, one approval,
      code owner, strict checks `app` and
      `Analyze (javascript-typescript)`). An authenticated agent
      runs those `gh` commands. Close the TypeScript 7 pull request
      if it is still open ([ci.md](ci.md) records pull request 3
      as closed). The deploy still needs the variables and secrets
      in the [ci.md](ci.md) deploy row, then `wrangler secret put`
      for the house keys.
- [ ] **owner · easy** First deploy of the native tree
      ([deploy-cloudflare.yml](../.github/workflows/deploy-cloudflare.yml)).
      `gate` fails the run unless `ci` succeeded on `main`. Prove
      the door and one agent at `https://gantree2.bldhosting.com`.
      The owner runs the deploy and is releasing `package.json`
      0.2.15.
- [ ] **owner · easy** Walk: add Bob on `/users`; he gets in; remove;
      `401` next click (§2).
- [ ] **owner · medium** Walk: build Kit on `/agents/new`; grant maps;
      put the key in; Kit's card goes green; Kit's log fold streams
      (§4). The path is the native brain.
- [ ] **owner · hard** Walk: a stranger with **one** README stands up
      Kit for two humans, yanks one, never opens the Cloudflare
      dashboard after the token (§8). The last box.

## Next — still open on the brain

What has landed is in [todo_done.md](todo_done.md) §10.

- [ ] **medium** CodeQL second pass. [ci.md](ci.md) records the
      workflow as green. The pass that points the queries at eslint
      is in flight. There is no `docs/codeql.md` in the tree.
- [ ] **hard** Deferred ports. Garmin `complete`: 81 tools past
      extended (core is 10, extended is 19;
      `GARMIN_TOOL_TIER=complete` currently publishes that same
      19). Google Drive, Docs, and Sheets past the everyday cores
      (9 + 15 + 10) and Apps Script (17). 88 tools are ported; the
      catalog has 139. Telegram, Discord, and Slack come back as
      webhook routes on the Worker.
- [ ] **medium** Decide: restore or drop. Left out of the loop port
      on purpose: process RSS on the log (`selfRSSMB`, VmRSS; the
      feeds plugin is the RSS reader and has landed), coalesce
      settle, spinup notice, reaction debounce, typing refresh
      (every 4s), draft throttle (250ms), and the `[room]` stamp
      (theme, wallpaper, face). Judgment strips a `[room]` line if
      one appears. Nothing writes the stamp.

## Then — one stack (§9)

- [ ] **medium** One stack, one week. Kit on the native brain
      through a real week: the planner fires, memory consolidates,
      a cron survives a restart, the owner talks to it every day.

## Hosted (Phase 5) — the paid door

**D — decided 2026-10-10:** gantree is a hosted product as well as a
self-hosted one. v1 (one household per deploy) was never durable
enough to sell; v2 on Workers, with celld at home, is. Self-hosting
stays first-class and free; the hosted door is the same code with a
tenant key. Pitch, prices, and the cost of one hosted agent:
[monetize.md](monetize.md). Nothing below starts before the first
deploy and the one-week soak. A hosted customer is not the first
stranger.

Ordered: the free, legal, and architectural prerequisites, then the
product.

- [ ] **owner · easy** Enrol in GitHub Sponsors (Settings → Sponsors
      → set up). `.github/FUNDING.yml` (`github: shotah`) and the
      README sponsor line are in; the button appears when the account
      is enrolled.
- [ ] **owner · medium** The entity: LLC in your state, registered
      agent, business bank account, EIN; a merchant of record (Lemon
      Squeezy / Paddle / Polar.sh) so sales tax and VAT are theirs.
      Needed before the first paid sign-up, not before.
- [ ] **owner · medium** Paper: Terms of Service and a hosted privacy
      policy (the Pages one covers the OAuth catch page only). The
      inventory they describe is written and exact:
      [security.md → What the service holds](security.md#what-the-service-holds--the-inventory)
      — credentials (every pasted key in the Agent DO, OAuth refresh
      tokens AES-GCM under `token.key` in that DO), chat (history in
      the Agent DO SQLite), and who-may-talk-to-whom. The paper wraps
      that list; it does not need to invent anything.
- [ ] **hard** Tenancy. Today one Settings DO is `idFromName(
      "settings")` and Agent DOs are `idFromName(slug)` —
      one household per deploy. Hosted needs a household id: Settings
      DO per household, Agent DOs named `<household>/<slug>`,
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
      `active` / `past_due` / `cancelled`). `NewAgent` refuses past
      the cap. `past_due` stops the agent after a grace period and
      keeps the DO database. No card data ever touches the Worker.
- [ ] **medium** Hosted guardrails: a per-household agent cap,
      `/users` add limited by plan, and LAN-only settings hidden on
      the hosted door.
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
      `https://gantree2.bldhosting.com/api/auth/catch`). This is also the
      free "set it up with me" product from monetize.md Path 1.
- [ ] **owner · easy** Price: $8–10 a month for one agent, $3–4 per
      extra agent on the household, 14-day trial, no one-time tier
      (the plan bills monthly). Revisit with the first ten.
- [ ] **hard** Walk: a stranger pays, signs in, builds Kit, pastes an
      LLM key, chats; cancels; the agent stops answering; the DO
      database is kept 30 days; `/login` says so.

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
- Operator writes on boards.
- A `gantree` CLI only if `npm` scripts are not enough — TypeScript.

## Other checkouts

Not this repo; listed so they are not forgotten.

- `gantree2-apps`: cab/helm shots on emulators and the stolen-phone
  paragraph's three pictures; store listing text; wiring the brand
  PNGs from `shared/brand/`; cab/helm wording of the stolen-phone
  paragraph matching [access.md](access.md).

## Not this product

- Kubernetes; Cloud Run / Lambda / App Runner — Workers hosted,
  celld at home
- Shared family brain — one agent's memory is one agent's
- Pairing the agent through settings; pairing codes in chat
- Reselling LLM tokens — bring your key, even on the hosted door
- A shared Google client for the tools — BYO client, hosted or not
- Invite links and orgs beyond one household per account
- A second login (passphrase, magic link, SSO beyond Google)
- Cloudflare Access in front of the Worker
- Role in the cookie
- MCP OAuth as a phone login
- Anything that makes the brain slower so a dashboard looks nicer

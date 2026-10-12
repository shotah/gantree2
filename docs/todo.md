# Work

The plan is [proposal.md](proposal.md); the pictures are
[architecture.md](architecture.md); what has shipped is
[todo_done.md](todo_done.md) (same section numbers, so "§5" means the
same thing in both). This is what is left, in the order to do it.

**State today (2026-10-11):** every screen, the door, the chat PWA,
the agent registry, the mark, the docs site on
`github.bldhosting.com`, release tooling. The Workers-native harness
is the only runtime ([todo_done.md](todo_done.md) §10). The runtime
directory is `harness/`. There is no container. The Durable Object
class named Harness was deleted in migration v3 and stays deleted.
`wrangler.jsonc` is Settings and Agent (SQLite) plus KV `DIRECTORY`.
The catalog is `toolCatalog()` from `harness/plugins`. `npm run agent`
starts (or reuses) Vite and opens browser chat on the native Agent DO with house
`LLM_*` from `.dev.vars`. Live eval is 30/30. `package.json` is
0.2.18, deployed from `main` `c3fa813`; local `package.json` is
0.2.30.
`GET https://gantree2.bldhosting.com/api/health` returns
`{"ok":true,"version":"0.2.18"}`. Tag eval for v0.2.18 is in
progress. Kit files tasks and goals from chat. Phones can sign in
without a browser (`/api/auth/{config,nonce,token}`). **Not yet
done:** the provider-console redirects, Bob's walk, the §4 native
walk, a stranger's README walk, and the one-week soak.

Legend: `[ ]` open · **owner** needs a human with a console · **gated**
waits on the note in the line · tags are `easy` / `medium` / `hard`
for effort. Each list is ordered easiest first. Decisions (**D**) that are settled live in
[todo_done.md](todo_done.md#0-decide); the one still open is hosted
pricing, in the Hosted section.

---

## Speed

A question in chat is slower than the old Go binary. That is the
work, not a dashboard. Do not make a turn slower so a chart looks
nicer. Measure, then cut the biggest wait.

- [ ] **medium** Time one chat question: door, Durable Object wake,
      model, tools, reply. Write the numbers on this line.
- [ ] **hard** Cut the largest wait from that trace. One change,
      then measure again.

## Now — blocks the first stranger

These need a human at the provider consoles and cannot be closed
from the repo.

- [ ] **owner · easy** Provider consoles for the tools (§7): the
      **tools** Google client, Strava, and Google Health list
      `https://gantree2.bldhosting.com/api/auth/catch` and
      `http://127.0.0.1:3000/api/auth/catch` as redirects. The
      consent screen's privacy URL is
      `https://github.bldhosting.com/privacy/`. Proof is a
      `/auth google` round trip in chat that lands a token.
- [ ] **owner · easy** Walk: add Bob on `/users`; he gets in; remove;
      `401` next click (§2).
- [ ] **owner · medium** Walk: build Kit on `/agents/new`; grant maps;
      put the key in; Kit's card goes green; Kit's log fold streams
      (§4). The path is the native harness.
- [ ] **owner · hard** Walk: a stranger with **one** README stands up
      Kit for two humans, yanks one, never opens the Cloudflare
      dashboard after the token (§8). The last box.

## Next — still open on the harness

What has landed is in [todo_done.md](todo_done.md) §10.
88 tools are ported; the catalog has 139.

- [ ] **easy** Look up Actions run 38172210169 (v0.2.18) and record
      pass or the failing step in this list.
- [ ] **easy** If run 38172210169 failed, fix the fixture or the
      harness and re-run.
- [ ] **easy** Weekly: `npm audit` for `braces`. No release after
      3.0.3. Not a lockfile edit. Do not claim a bump is safe.
- [ ] **easy** Weekly: `npm audit` for `fflate`. satori pins 0.7.3.
      0.7.5+ and 0.8.3 fix the advisory. Not a lockfile edit. Do not
      claim a bump is safe.
- [ ] **easy** Process RSS on the log (`selfRSSMB`, VmRSS; the feeds
      plugin is the RSS reader and has landed). Decide restore or
      drop. Do not implement it.
- [ ] **easy** Coalesce settle. Decide restore or drop. Do not
      implement it.
- [ ] **easy** Spinup notice. Decide restore or drop. Do not
      implement it.
- [ ] **easy** Reaction debounce. Decide restore or drop. Do not
      implement it.
- [ ] **easy** Typing refresh every 4s. Decide restore or drop. Do
      not implement it.
- [ ] **easy** Draft throttle 250ms. Decide restore or drop. Do not
      implement it.
- [ ] **easy** The `[room]` stamp (theme, wallpaper, face). Judgment
      strips a `[room]` line if one appears. Nothing writes the
      stamp. Decide restore or drop. Do not implement it.
- [ ] **medium** Google Drive past 9. Next slice: one Drive tool.
      The rest waits.
- [ ] **medium** Google Docs past 15. Next slice: one Docs tool.
      The rest waits.
- [ ] **medium** Google Sheets past 10. Next slice: one Sheets tool.
      The rest waits.
- [ ] **medium** Apps Script (17). Next slice: one Apps Script tool.
      The rest waits.
- [ ] **medium** Telegram webhook route on the Worker. Next slice:
      that route.
- [ ] **medium** Discord webhook route on the Worker. Next slice:
      that route.
- [ ] **medium** Slack webhook route on the Worker. Next slice:
      that route.
- [ ] **medium** Garmin `complete` past the 19 extended tools (core
      is 10, extended is 19; `GARMIN_TOOL_TIER=complete` currently
      publishes that same 19; 81 tools sit past extended). Next
      slice: one Garmin group. The rest waits.

## Then — one stack (§9)

Does not start in a coding session.

- [ ] **owner · medium** One stack, one week. Kit on the native harness
      through a real week: the planner fires, memory consolidates,
      a cron survives a restart, the owner talks to it every day.

## Hosted (Phase 5) — the paid door

Nothing here starts before the soak.

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
- [ ] **owner · medium** Terms of Service. The inventory it describes
      is written and exact:
      [security.md → What the service holds](security.md#what-the-service-holds--the-inventory)
      — credentials (every pasted key in the Agent DO, OAuth refresh
      tokens AES-GCM under `token.key` in that DO), chat (history in
      the Agent DO SQLite), and who-may-talk-to-whom. The paper wraps
      that list; it does not invent anything.
- [ ] **owner · medium** Hosted privacy policy. The Pages one covers
      the OAuth catch page only. Same inventory as the Terms. It
      wraps that list; it does not invent anything.
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

- [ ] **easy** Chat screen restyle. `PhoneShell` was not touched by
      the console restyle; the Cab shot has a backdrop and an avatar,
      which the web chat supports and the seed does not set (§7).
      First slice: set the backdrop on the seed. The avatar and the
      rest of the restyle wait.
- [ ] **easy** Per-person spend (carried). Samples carry `agent`,
      `kind`, `value` — no `user_id` — so "sub → display name" has
      nothing to name yet. First slice: a `who` column from the
      `perf` frame's `source`. The display-name join waits.
- [ ] **owner · easy** Web push walk (§3). First slice: the VAPID
      trio in `.dev.vars` and one push. The rest of the walk waits.
- [ ] **medium** Workspace `hd` gate on sign-in. The list stays the
      rule. First slice: one sign-in branch that reads `hd`. Skipping
      the allowlist for that domain waits.
- [ ] **medium** Compare fold (carried): overlay tokens for 2–3
      agents. Logs stay per agent. First slice: one route (`/settings`
      Spend or `/agents`) overlaying two agents. The third agent and
      the other route wait.
- [ ] **medium** Provider billing pull. Spend is tokens plus a pasted
      rate. First slice: one provider into one column. Other
      providers wait.
- [ ] **medium** Operator writes on boards. First slice: one route
      that writes the aims board. The todo board waits.
- [ ] **gated** Navigation uses `window.location.assign` (full
      reloads). Starts once the walks are done (§4). First slice: the
      `/chat` leave in `AgentRoomControls`. `assignHref` on the agent
      screens waits.
- [ ] **gated** Saved watches / tile catalog. Starts after one
      attention surface stops being enough. First slice: one saved
      watch. The catalog waits.
- [ ] **gated** A `gantree` CLI, TypeScript, only if `npm` scripts
      are not enough. First slice, if it starts: one command. The
      rest waits.

## Other checkouts

Not this repo; listed so they are not forgotten.

- `gantree2-apps`: cab/helm shots on emulators and the stolen-phone
  paragraph's three pictures; store listing text; wiring the brand
  PNGs from `shared/brand/`; cab/helm wording of the stolen-phone
  paragraph matching [access.md](access.md).
- [ ] **owner** `gantree2-apps` cab: sign in against this backend and
      send one turn. Helm can follow. That work is the other
      checkout, not this repo.

## Not this product

Decided. These stay out.

- Kubernetes, Cloud Run, Lambda, App Runner. Hosted is Cloudflare
  Workers. Home is celld.
- Cloudflare Access in front of the Worker. It rejects the WebSocket
  and it is a second identity system.
- Role in the cookie. The cookie proves who. The user row proves the
  role, and it is read on every request, so taking admin away works
  on the next click. A role baked into the cookie would stay admin
  until the cookie died.
- MCP OAuth as a phone login. That OAuth is how a tool server
  (Gmail, a plugin) authorizes a call. The phone signs in with
  Google. The tool token is not the door.
- Pairing codes. Dropped. They were an old "type a code in chat to
  link a device" idea. The door is the allow list. Nobody asked
  for the codes.
- A passphrase or magic-link door.
- Anything that makes a turn slower so a dashboard looks nicer.

## Future — not now, not never

These were parked because too much else was open. They are not a
ban. Do not build one until its box says to.

- [ ] **medium** Shared / group agent. Tell the agent who is
      speaking (the signed-in user) and let it keep that person's
      preferences. User A's grants do not include user B's mail,
      files, or tokens. One agent's memory is still one agent's.
- [ ] **medium** What more people looks like. Tenancy, a household
      id, and invite links are the Hosted section, and that section
      stays gated on the soak. This box is a write-up of what
      pushing the same door to more households needs, before any of
      that code.
- [ ] **easy** Resell LLM tokens only if a customer asks. Until
      then, bring your own key.
- [ ] **easy** Shared Google client for the tools. Undecided. Today
      each agent has its own client. A shared client has to name
      the mailbox and the person. Write that picture before any
      code.
- [ ] **medium** Another login beside Google. Candidates: Cloudflare
      and GitHub. Not a passphrase. Not this week.

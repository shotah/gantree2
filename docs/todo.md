# Open items

The plan and the phase checklists live in [proposal.md](proposal.md).
Shipped design: [architecture.md](architecture.md) (pictures,
invariants), [access.md](access.md) (one person across settings,
chat, agent), [install.md](install.md), [custom-mcp.md](custom-mcp.md).

This file is what is left **beyond** the phase checklists: walks a
stranger must be able to do, carried-over items from the originals,
and the bin. A box is done when a stranger can do the walk with this
repo alone.

Status: **now** · **next** · **later** · **not this product**

---

## Now — Phase 1 walks

- [ ] **Door, local:** clone, `.dev.vars`, `npm run dev`, sign in at
      `127.0.0.1:3000`. Second Google account → `not_allowed`. Add it
      on `/users` → in. Remove → `401` on the next click, cookie or not.
- [ ] **Door, Cloudflare:** push to `main`; Actions vars seed
      `GANTREE_ADMINS`; same walk on the Worker origin. No dashboard
      visit after the token.
- [ ] **Door, home:** celld + Tailscale HTTPS; same walk. Google
      redirect works on the `.ts.net` host.
- [ ] **No admins:** deploy with `GANTREE_ADMINS` empty → every page
      `503` with the one-line fix. Nothing else leaks.
- [ ] **Theme:** pick Siren on a phone, reload → Siren. Agent sets
      Marquee → follows. Pin own → agent's pick shows the tag, does
      not paint.

## Now — carried from the originals

Still true on this stack. Each becomes a fold or a check on
`/agents/<slug>`.

- [ ] **Backup is a loop.** List stamps under `backups/<slug>/` in R2.
      Restore = pick a stamp, recreate. Prune = keep last N or retain
      days, admin, confirm-scary. Refuse `.env` / `mcp.toml` / oauth
      files even if a curious stamp contains them.
      **Walk:** back up Kit. Chat. Restore Thursday. Kit remembers
      Thursday, not the chat after.
- [ ] **Retire confirm:** type the slug. Audit who retired what. Kit
      is another DO — it survives Ada's retire.
- [ ] **Compare fold** on `/`: pick 2–3 agents, overlay tokens. Logs
      stay per agent. Audit extras: who, last N, jsonl.
- [ ] **Stolen-phone paragraph** agrees across access.md, cab, helm
      (OS lock → Google sign-out → remove on `/users` → untick on the
      agent → rotate bearer).
- [ ] **Chat pitch:** one multi-step turn with tool trace captured
      from a real agent on this stack, not a mock.

## Now — carry from ai-gantry

ai-gantry was the seed; most of its docs describe the harness that
moves into `harness/` unchanged. Each one gets copied into `docs/`,
re-pathed (`harness/…`), and re-worded (agent, settings, chat) when
`harness/` lands. Already carried: [eval_setup.md](eval_setup.md),
[mcp-naming.md](mcp-naming.md), [custom-mcp.md](custom-mcp.md).

- [ ] `mcp.md` — host mechanics: `mcp_enable`, prefixes, tiers, repair
- [ ] `auth.md` — the OAuth hop argv plugins implement (`auth_args`,
      PKCE paste, device, mfa); tokens land in `config.env`, not the image
- [ ] `persona.md`, `persona_doc_goals.md`, `evaluation_fable.md` —
      the behavior contract behind the eval; one seed, no lockstep
- [ ] `reactions.md` — `[react …]`, kernel triage, the eval gates
- [ ] `cron.md`, `planner-siblings.md` — the planner tick is a Cron
      Trigger → Agent DO alarm, not an in-container timer
- [ ] `channels.md` — chat is the default; Telegram / Discord / Slack
      stay as `CHANNEL=` values the harness still speaks
- [ ] `gantree-contract.md` → `contract.md` — frames (`cmds`, `allow`,
      `status`, `config`, `perf`, `log`, `snapshot`), env the DO injects
- [ ] `design.md`, `features.md`, `architecture.md` → fold what still
      holds into [architecture.md](architecture.md) §9–10; drop the
      Docker-host parts
- [ ] `troubleshooting.md` — re-keyed to DO state, R2 snapshots, celld
      and Workers logs instead of `docker logs`
- [ ] `deploy-docker.md`, `deploy-native.md`, `dockerhub.md` — **not
      carried**; [install.md](install.md) replaces them
- [ ] `.env.example` → `harness/.env.example` (the eval's three `LLM_*`)
- [ ] Eval fixtures and `mcp.toml` → `harness/internal/agent/testdata/eval/`;
      `tools_from` builds the sibling plugin instead of fetching a release

---

## Next — Phase 2 and 3 extras

Beyond the proposal's checklists.

- [ ] `perf` frame sampling → Settings DO; graphs match the original
      console within a sample.
- [ ] Per-agent log fan-out rate cap, and what happens to a phone that
      cannot keep up (drop oldest, say so).
- [ ] `home_only` servers hidden on Cloudflare, shown under celld;
      status frame says which.
- [ ] Spend: `user_id` → display name from the Settings users table;
      "store this `sub` on Ada" offer, then `sub:email` on the room
      list.
- [ ] Cab and helm read `/api/auth/me` with `agents` (and the `cranes`
      alias until Phase 4) and connect to the new origin with no app
      change.

---

## Later

Do these when a real gap forces it.

- Workspace `hd` gate on sign-in (household on one domain).
- Saved watches / a catalog of tiles — only after one attention
  surface has been enough for months and is not.
- GCP / provider usage pull (billed $). Spend is tokens plus an
  optional pasted rate — "who burned the budget", not an invoice.
- Harness writes `gantry.db` through to DO SQLite over the socket
  (instead of R2 snapshots). Go storage change; only if snapshot lag
  ever loses a turn that mattered.
- Operator writes on boards (create / pin / check in). Agents stay the
  mouth; the page is read-only.
- A `gantree` CLI only if `npm` scripts are genuinely not enough —
  still TypeScript.

---

## Not this product

- Hosted gantree SaaS / spinning agents for paying customers
- Kubernetes, Cloud Run, Lambda, App Runner
- Shared family brain
- Pairing the agent through settings; pairing codes in chat
- Multi-tenant orgs, invite links, billing
- A second login (passphrase, magic link, SSO beyond Google)
- Cloudflare Access in front of the Worker
- Role in the cookie
- MCP OAuth as a phone login
- Anything that makes the harness slower so a dashboard looks nicer

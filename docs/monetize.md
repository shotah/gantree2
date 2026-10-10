# Paying for it

Decided 2026-10-10: gantree is sold, not only given away
([todo_done.md](todo_done.md#0-decide)). This page is the why and the
numbers; the ordered work is the Hosted section of
[todo.md](todo.md#hosted-phase-5--the-paid-door). Numbers are from
Cloudflare's published rates on 2026-10-10 and a one-line estimate;
redo them before quoting a price.

## What is actually for sale

The repo is public and the product is "assistants **you** run". Nobody
pays $5 for access to code they can clone, and a paywall on a public
repo is a speed bump, not a product. What people do pay for:

1. **Not having to do the walk.** Cloudflare account, Workers Paid,
   Google client, redirect URIs, secrets, `wrangler deploy`, the
   harness image. The README makes it possible; a stranger still
   spends an afternoon. That afternoon is the product.
2. **A door that is already open.** A hosted gantree where they sign
   in with Google, paste an LLM key, and chat with Kit in two minutes.
   They bring the keys; we bring the Worker, the DO, and the container.
3. **Saying thanks.** A tip jar costs nothing to add and some people
   use it.

Three paths, cheapest first.

## Path 0 — tip jar (an afternoon, no entity)

- `.github/FUNDING.yml` → GitHub's **Sponsor** button on the repo.
  GitHub Sponsors takes no cut from individual sponsors; Ko-fi takes
  none on donations; Buy Me a Coffee takes a small percentage. List
  one or two, not five.
- A "Support" line in the README and the site footer, next to the
  badges. One sentence; no popup.
- Tax: income regardless of the label. A sole proprietor reports it
  on the personal return; no LLC needed for tips.

Expected: beer money. Worth doing because it is free and because a
Sponsor button is social proof on the repo page.

## Path 1 — sell the afternoon (a weekend, no entity to start)

- **"Set it up with me"**: a one-hour screen-share, you drive their
  Cloudflare and GCP consoles, they leave with Kit answering. Priced
  like an hour of a contractor's time (tens of dollars, not five), paid
  through a Stripe Payment Link or a merchant-of-record checkout
  (Lemon Squeezy / Paddle / Polar.sh handle sales tax and VAT, so you
  never register for tax anywhere; they take a few percent plus a
  fixed fee — check current rates). Booking through Cal.com or
  Calendly's free tier.
- **Guided setup as software, later**: a `npm run setup` that walks
  the console steps with links and pastes, checks each one (`/api/
  auth/me` answers, the Google redirect matches, the container starts).
  This is the real product of this path and it is worth building for
  the free walk anyway; charging for it is optional.
- Sole proprietorship is enough. Keep a ledger. Form an LLC when the
  money is real or when Path 2 starts.

Expected: a few sales a month if the README gets traffic; the most
money per hour of effort of the three while the user count is small.

## Path 2 — hosted door (weeks, LLC first)

The product: **we run the Worker and the container; they bring every
key.** No shared brain, no shared Google client for the
tools, no billing for tokens. The existing design already does the
hard part — one Agent DO and one container per agent, Google sign-in
per person, keys pasted into the agent's own env.

### What one hosted agent costs us

`edge/harness.do.ts` holds a WebSocket from the harness to the Agent
DO, so a hosted agent never sleeps (`sleepAfter` only matters when
the socket drops). On the default `lite` instance (1/16 vCPU, 256 MiB,
2 GB), 730 h a month, at Cloudflare's rates:

| Line | Rate | Per agent / month |
| --- | --- | --- |
| Workers Paid plan | $5 flat per account | amortised over all agents |
| Memory | 256 MiB × 730 h, $0.0000025 per GiB-s | ≈ $1.60 |
| Disk | 2 GB × 730 h, $0.00000007 per GB-s | ≈ $0.37 |
| CPU | active only; an idle harness is mostly waiting | ≈ $0.10–0.50; worst case (pegged 1/16 vCPU) ≈ $3 |
| DO requests, R2, KV | chat frames, snapshots every 5 min | pennies |

The plan's included 25 GiB-h / 375 vCPU-min / 200 GB-h cover most of
the **first** agent. So: the first hosted agent costs ≈ $5–6 (the
plan), every agent after it ≈ $2–3. LLM tokens are theirs.

### What we would charge

$5/month for one agent is roughly break-even on Cloudflare alone and
pays nothing for the time, the ToS, or the night it goes down. $8–10
a month for one agent, $3–4 for each extra agent on the same account,
is a real margin and still less than the Workers Paid plan they would
otherwise buy themselves — that is the pitch line: *"less than
Cloudflare charges you to host it yourself, and you skip the walk."*
A one-time $5 fee does not work: the container bills monthly.

Twenty paying people at $9 is $180/month, maybe $120 after Cloudflare
and fees. It does not repay the sunk hours quickly; it does turn the
project into one that pays its own bills, and it is the only path
where growth is not your calendar.

### What it costs in things other than money

- **We hold their keys.** The Agent DO stores the LLM key they paste
  and the key that decrypts the OAuth token snapshot
  ([security.md](security.md) register #4). Self-hosted, that is
  their Worker; hosted, it is ours. That needs a Terms of Service, a
  privacy policy that is not just the Pages one, and an LLC so the
  party to the ToS is not you personally. Budget a state filing fee
  plus an annual report (varies by state; tens to a few hundred
  dollars), a registered agent if you do not want your home address
  on it, a business bank account, and a merchant of record so sales
  tax is their problem.
- **Google verification.** Sign-in asks only `openid email profile`
  (non-sensitive), so the hosted login app needs brand verification
  and a privacy URL, not a security assessment. The **tools** Google
  client (Gmail, Drive) stays **theirs** — a shared client with
  restricted scopes over 100 users would need the paid third-party
  assessment, and we would be the ones liable for everyone's inbox.
  Keep the "tools are BYO client" rule for hosted or the economics
  break.
- **Abuse.** A hosted container runs whatever MCP plugins the catalog
  offers against keys we did not issue. Cap agents per account, keep
  `max_instances` real, and refuse custom manifests on hosted.
- **Support.** Every Google redirect mismatch is now an email to you.
  Path 1's guided setup is what makes Path 2 survivable.

## Order

1. **Pick a license and commit it.** The README badge points at a
   `LICENSE` that does not exist. MIT or Apache-2.0 if the code stays
   open and the money comes from Paths 0–2 (recommended — the pitch
   is "you run it", and open is how a stranger trusts it with their
   Gmail). A source-available license (PolyForm Noncommercial, FSL)
   only if the plan is to stop others hosting it for money, and that
   trades away the "assistants you run" story. Decide once.
2. Path 0 this week: `FUNDING.yml`, a Support line, done.
3. Path 1 after the stranger walk in [todo.md](todo.md) §8 passes —
   the walk *is* the thing being sold, so it has to work first.
4. Path 2 after the cutover (§9) and the OAuth snapshot, backup loop,
   and `LLM_*`-after-frame items are closed. The architectural work is
   tenancy: today one Settings DO is `idFromName("settings")` and
   Agent / Harness DOs are named by bare slug — one household per
   deploy. Hosted names them by household, and self-hosted stays the
   one-household case. Then the LLC, the ToS, the landing page with a
   Google button and a price, and a merchant-of-record webhook that
   writes the household's plan row (the gate already exists; billing
   just writes to it).

## Not worth it

- Charging for the code or the image. Public repo, GHCR image; a
  paywall there costs trust and gains nothing.
- Reselling LLM tokens. Margins are thin, abuse is yours, and "bring
  your key" is already the product.
- An app-store app with in-app purchase. Cab and helm are thin
  clients; the money, if any, is on the door.

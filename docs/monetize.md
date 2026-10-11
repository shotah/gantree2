# Paying for it

Decided 2026-10-10: gantree is sold, not only given away
([todo_done.md](todo_done.md#0-decide)). This page is the why and the
numbers; the ordered work is the Hosted section of
[todo.md](todo.md#hosted-phase-5--the-paid-door). Every rate below is
from a Cloudflare or GitHub pricing page read on 2026-10-10, linked
where it is used; the arithmetic is shown so it can be redone when the
rates move.

## What is actually for sale

The repo is public and the product is "assistants **you** run". Nobody
pays $5 for access to code they can clone, and a paywall on a public
repo is a speed bump, not a product. What people do pay for:

1. **Not having to do the walk.** Cloudflare account, Google client,
   redirect URIs, secrets, `wrangler deploy`. The README makes it
   possible; a stranger still spends an afternoon. That afternoon is
   the product.
2. **A door that is already open.** A hosted gantree where they sign
   in with Google, paste an LLM key, and chat with Kit in two minutes.
   They bring the keys; we bring the Worker and the Durable Object.
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
  auth/me` answers, the Google redirect matches, chat answers).
  This is the real product of this path and it is worth building for
  the free walk anyway; charging for it is optional.
- Sole proprietorship is enough. Keep a ledger. Form an LLC when the
  money is real or when Path 2 starts.

Expected: a few sales a month if the README gets traffic; the most
money per hour of effort of the three while the user count is small.

## Path 2 — hosted door (weeks, LLC first)

The product: **we run the Worker; they bring every key.** No shared
brain, no shared Google client for the tools, no billing for tokens.
The existing design already does the hard part — one Agent DO per
agent, Google sign-in per person, keys pasted into the agent's own
env.

### Why the bill is small

Everything we have run to date sits inside Cloudflare's **Workers Free**
plan, and GitHub Pages is free. Cloudflare's own pages, read
2026-10-10:

| Piece | We use it for | Free plan | Paid plan ($5/month per account) | Source |
| --- | --- | --- | --- | --- |
| Workers | the door, every route | 100,000 requests/day, 10 ms CPU each | 10 M requests + 30 M CPU-ms/month included; $0.30/M requests, $0.02/M CPU-ms after | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Durable Objects (SQLite) | Settings, one Agent per slug | 100,000 requests/day; 13,000 GB-s/day duration; 5 M rows read + 100,000 rows written/day; 5 GB stored | 1 M requests, 400,000 GB-s, 25 B rows read, 50 M rows written, 5 GB-month included; $0.15/M requests, $12.50/M GB-s, $0.20/GB-month after | [Durable Objects on the Workers pricing page](https://developers.cloudflare.com/workers/platform/pricing/#durable-objects) |
| Workers KV | `DIRECTORY` (who is in which room) | 100,000 reads + 1,000 writes/day, 1 GB | 10 M reads, 1 M writes, 1 GB included | [KV on the Workers pricing page](https://developers.cloudflare.com/workers/platform/pricing/#workers-kv) |
| GitHub Pages | docs site, privacy page | free for public repos | — | GitHub |

`npm run dev` costs nothing. A hosted agent is Durable Object requests
and duration while a turn or an alarm runs, plus Worker requests.
Waiting on the model and on `fetch` does not spend CPU time. Between
alarms the cost is zero. Durable Object SQLite storage only started
billing in January 2026 and our objects are small.

### What one hosted agent costs us

There is no provisioned box. The bill is the table above, for the time
a turn or an alarm is actually running. LLM tokens are the customer's,
on the key they pasted.

### What we would charge

$8–10 a month for one agent, $3–4 for each extra agent on the same
account, is a margin over that usage and still in the neighborhood of
a Workers Paid plan they would otherwise buy themselves — that is the
pitch line: *"what you would spend an afternoon standing up, already
running."* A one-time fee does not work: the account bills monthly.

Twenty paying people with one agent each at $9 is $180/month. The
Cloudflare side of that is Worker and Durable Object usage while they
talk, not a box per agent, and a merchant of record takes ≈ 5 % + a
fixed fee. It does not repay the sunk hours quickly; it does turn the
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
- **Abuse.** A hosted agent runs the catalog plugins against keys we
  did not issue. Cap agents per account and refuse a custom plugin
  set on hosted.
- **Support.** Every Google redirect mismatch is now an email to you.
  Path 1's guided setup is what makes Path 2 survivable.

## Order

1. **License: MIT**, decided 2026-10-10 (root `LICENSE`). The code
   stays open and the money comes from Paths 0–2 — the pitch is "you
   run it", and open is how a stranger trusts it with their Gmail. A
   source-available license (PolyForm Noncommercial, FSL) was the
   alternative and would have traded away that story.
2. Path 0: `FUNDING.yml` and the README sponsor line are in; enrol in
   GitHub Sponsors so the button shows.
3. Path 1 after the stranger walk in [todo.md](todo.md) §8 passes —
   the walk *is* the thing being sold, so it has to work first.
4. Path 2 after tenancy. Today one Settings DO is `idFromName("settings")`
   and Agent DOs are named by bare slug — one household per deploy.
   Hosted names them by household, and self-hosted stays the
   one-household case. Then the LLC, the ToS, the landing page with a
   Google button and a price, and a merchant-of-record webhook that
   writes the household's plan row (the gate already exists; billing
   just writes to it).

## Not worth it

- Charging for the code. Public repo; a paywall there costs trust
  and gains nothing.
- Reselling LLM tokens. Margins are thin, abuse is yours, and "bring
  your key" is already the product.
- An app-store app with in-app purchase. Cab and helm are thin
  clients; the money, if any, is on the door.

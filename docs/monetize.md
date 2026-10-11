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

The product: **we run the Worker; they bring every key.** No shared
brain, no shared Google client for the tools, no billing for tokens.
The existing design already does the hard part — one Agent DO per
agent, Google sign-in per person, keys pasted into the agent's own
env. A native agent has no container to bill. A container agent is
the legacy line item below.

### Why it has been free so far, and where the charge comes from

Everything we have run to date sits inside Cloudflare's **Workers Free**
plan, and GitHub Pages is free. The one thing that is not on the free
plan is **Containers** — the harness box — and that is the whole bill.
Cloudflare's own pages, read 2026-10-10:

| Piece | We use it for | Free plan | Paid plan ($5/month per account) | Source |
| --- | --- | --- | --- | --- |
| Workers | the door, every route | 100,000 requests/day, 10 ms CPU each | 10 M requests + 30 M CPU-ms/month included; $0.30/M requests, $0.02/M CPU-ms after | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Durable Objects (SQLite) | Settings, one Agent per slug, one Harness per slug | 100,000 requests/day; 13,000 GB-s/day duration; 5 M rows read + 100,000 rows written/day; 5 GB stored | 1 M requests, 400,000 GB-s, 25 B rows read, 50 M rows written, 5 GB-month included; $0.15/M requests, $12.50/M GB-s, $0.20/GB-month after | [Durable Objects on the Workers pricing page](https://developers.cloudflare.com/workers/platform/pricing/#durable-objects) |
| Workers KV | `DIRECTORY` (who is in which room) | 100,000 reads + 1,000 writes/day, 1 GB | 10 M reads, 1 M writes, 1 GB included | [KV on the Workers pricing page](https://developers.cloudflare.com/workers/platform/pricing/#workers-kv) |
| R2 | `STORE` — snapshots (`gantry.db`, `SELF.md`, `tokens_tar`) | 10 GB-month, 1 M Class A (PUT), 10 M Class B (GET) per month; egress free | $0.015/GB-month, $4.50/M PUT, $0.36/M GET after | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| **Containers** | **the harness, one per agent** | **not available** | included: 375 vCPU-min, 25 GiB-h memory, 200 GB-h disk per month; then $0.000020/vCPU-s, $0.0000025/GiB-s, $0.00000007/GB-s | [Containers pricing](https://developers.cloudflare.com/containers/pricing/) |
| GitHub Pages | docs site, OAuth catch page, privacy page | free for public repos | — | GitHub |
| GHCR | prebuilt harness image | free for public images | — | GitHub |

So: `npm run dev` costs nothing. A native agent on Cloudflare has no
container cost. The first time a container starts, the account must be
on Workers Paid, and that is the $5 — only for agents still on
`runtime: container`. Durable Object SQLite storage only started
billing in January 2026 and our objects are small, so it stays at $0
on either plan while a turn is not running.

### What one hosted agent costs us

A native agent (`runtime: native`) has no container. It does not hold
a WebSocket open and it does not snapshot to R2. The bill is Durable
Object requests and duration while a turn or an alarm runs, plus the
model tokens the customer pays their provider. Waiting on the model
and on `fetch` does not spend CPU time. Between alarms the cost is
zero. Workers Paid is not required for that agent. The manifest in
this tree still declares the Harness binding, so a deploy of the whole
manifest still needs the Containers API until that binding is removed
([install.md](install.md#containers-legacy)).

The arithmetic below is a container agent. `edge/harness.do.ts` holds
a WebSocket from the harness to the Agent DO, so that agent never
sleeps (`sleepAfter` only matters when the socket drops). Containers
bill memory and disk on what is
*provisioned* and CPU on what is *used*, per the pricing page above.
On the default `lite` instance (1/16 vCPU, 256 MiB, 2 GB disk — the
[instance table](https://developers.cloudflare.com/containers/platform/limits/)),
running 730 h a month:

| Line | Arithmetic | Per agent / month |
| --- | --- | --- |
| Workers Paid plan | $5 flat per account | amortised over all agents |
| Memory | 0.25 GiB × 730 h = 182.5 GiB-h; minus 25 included = 157.5 GiB-h × 3600 × $0.0000025 | **$1.42** |
| Disk | 2 GB × 730 h = 1,460 GB-h; minus 200 included = 1,260 GB-h × 3600 × $0.00000007 | **$0.32** |
| CPU | active only. Idle harness ≈ 1–5 % of 1/16 vCPU → under the 375 included minutes | **$0** typical; pegged 1/16 vCPU all month = 164,250 vCPU-s − 22,500 included = 141,750 × $0.000020 = **$2.84** worst case |
| DO + KV + R2 | one WebSocket, a snapshot PUT every 5 min (≈ 26,000 PUTs/month, inside R2's 1 M free), a few MB stored | **$0** inside the included amounts |

**First hosted agent ≈ $6.75/month** (plan + $1.74 above the included
allotment). **Each additional agent ≈ $1.75–4.60/month** (the included
allotment is already spent; CPU decides where in that range). LLM
tokens are theirs. Redo this table if the instance type changes —
`basic` (1/4 vCPU, 1 GiB, 4 GB) roughly quadruples memory and
doubles disk.

### What we would charge

$5/month for one agent is below cost for the first customer and about
break-even after that, and pays nothing for the time, the ToS, or the
night it goes down. $8–10 a month for one agent, $3–4 for each extra
agent on the same account, is a real margin and still no more than the
Workers Paid plan they would otherwise buy themselves — that is the
pitch line: *"what Cloudflare would charge you to host it yourself,
and you skip the walk."* A one-time $5 fee does not work: the
container bills monthly.

Twenty paying people with one agent each at $9 is $180/month; our
Cloudflare bill for them is $5 + 20 × ≈ $1.75–4.60 ≈ $40–97, and a
merchant of record takes ≈ 5 % + a fixed fee, so ≈ $70–130 net. It does not repay the sunk hours quickly; it does turn the
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

1. **License: MIT**, decided 2026-10-10 (root `LICENSE`). The code
   stays open and the money comes from Paths 0–2 — the pitch is "you
   run it", and open is how a stranger trusts it with their Gmail. A
   source-available license (PolyForm Noncommercial, FSL) was the
   alternative and would have traded away that story.
2. Path 0: `FUNDING.yml` and the README sponsor line are in; enrol in
   GitHub Sponsors so the button shows.
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

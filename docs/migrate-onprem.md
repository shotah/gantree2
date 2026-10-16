# Migrate on-prem agent state to cloud

Move **memories**, **goals**, **persona files**, and **SELF.md** from a home
celld Agent Durable Object SQLite into an agent that already exists on
Cloudflare. This is a one-way copy of harness tables, not a full room clone.

The on-prem file is the Agent DO database that contains a `memory` table. On
a home box that is the sqlite backing that agent’s Durable Object (often
referred to as `gantry.db` in older docs).

There is **no public HTTP migrate URL** on gantree.bldhosting.com (or
elsewhere). Import runs from your laptop via Wrangler **remote bindings** and
talks to the Agent Durable Object with internal `X-Chat-Op` requests.

---

## What is copied

| Data | Where it lives |
| --- | --- |
| Structured memory rows | `memory` (`kind`, `subject`, `content`, …) — includes goal rows (`aim/…`, `todo/`, `waiting/`, `follow/`, `pref/`) |
| Aims ledger | `aim_event`, `aim_score`, `aim_block` |
| Operator persona markdown | `persona_file` (`PERSONA.md`, extra `.md` files) |
| Agent-written SELF | `selfnote` (SELF.md body) |

**Goals** are the `aim/<area>` memory rows plus the aims ledger tables. The
phone aims board rebuilds from those rows and ledger events; it is not a
separate snapshot you copy.

---

## What stays behind

Do **not** expect OAuth, chat, or ops state to move:

| Left behind | Why |
| --- | --- |
| `oauth_token` and plugin pending tables (`garmin_mfa_pending`, `google_oauth_pending`, `strava_oauth_pending`) | Secrets — re-link Google, Garmin, Strava, etc. on the cloud agent |
| Session cookies and room bearer | New origin, new tokens |
| Chat transcript (`session`, `session_message`) | Not exported; start fresh threads in cloud |
| Agent config env keys, MCP grants, cron schedules | Create/configure the cloud agent separately; re-run OAuth and cron setup there |
| Room allow lists, avatars, push subscriptions | Room metadata on the DO / settings store |

The export script never reads secret tables. The JSON file **is** sensitive
(persona text, memories, notes) — treat it like a password backup.

---

## Steps

### 1. Copy the on-prem SQLite

From the home host, copy the Agent DO sqlite that contains `memory` (stop the
agent or take a consistent copy if your platform requires it).

### 2. Export JSON (any machine with Node 22)

```bash
cd gantree2
npm run export-onprem -- --db /path/to/gantry.db --out onprem-kit.json
```

Logs print **counts only**, not row contents.

### 3. Create the cloud agent

Sign in as admin on the deployed site. Create the target agent slug on
`/agents` if it does not exist yet.

### 4. Import JSON (laptop with Cloudflare auth)

Authenticate to Cloudflare (not the gantree2 browser session):

- `CLOUDFLARE_API_TOKEN` with Workers/Durable Objects access, **or**
- `npx wrangler login`

Check auth with `npx wrangler whoami`.

From the repo:

```bash
npm run import-onprem -- --slug kit --in onprem-kit.json --remote
```

`--remote` is required so a casual run cannot target production by mistake.
The script uses Wrangler remote bindings to reach the live Agent DO for that
slug.

Import **inserts** memory and aims rows (same semantics as internal
`memory_import`). Run against a fresh agent or expect primary-key conflicts if
you import twice.

### 5. Re-link integrations

Open the cloud agent settings, reconnect OAuth plugins, and recreate cron jobs
that lived in config rather than in the exported tables.

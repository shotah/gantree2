# Channels

One `CHANNEL` per agent. All mouths are outbound-only + allowlist (empty
list fails boot). The mouth this product runs is **chat**: the harness
dials the Agent DO, and the phone joins the same room.
[architecture.md](architecture.md). Cab and helm are native apps on that
same room, not a second channel. Android Auto is one surface of cab.
Their backlog is not in this repo ([todo.md](todo.md) §0). Telegram,
Discord, and Slack are vendor options the harness still speaks. An unset
`CHANNEL` still defaults to `telegram`. Stdio is the local REPL
(`make run` inside `harness/`, which lands with [todo.md](todo.md) §5).

Two mouths means two agents — one container each, one allowlist each.
[architecture.md](architecture.md). The three-repo diagram is not carried.

Allowlist grammar: [access.md](access.md#allowlist-entry-grammar).

---

## Discord (Gateway)

Outbound WebSocket. DMs only. No inbound ports.

1. [Discord Developer Portal](https://discord.com/developers/applications) →
   New Application → **Bot** → Reset Token.
2. **Bot → Privileged Gateway Intents:** enable **Message Content Intent**.
3. Invite the bot (OAuth2: scope `bot`). Open a **DM**.
4. Developer Mode → right-click your avatar → **Copy User ID**.

```bash
CHANNEL=discord
DISCORD_BOT_TOKEN=...
DISCORD_ALLOWED_USERS=123456789012345678   # snowflakes
```

Streaming default on. Image attachments → vision; reply images as embeds.
Cron push DMs every allowlisted user (CHANNEL is the destination).

---

## Slack (Socket Mode)

Outbound WebSocket. HTTP Events API (public Request URL) is a non-goal — it
would open a port.

1. [api.slack.com/apps](https://api.slack.com/apps) → Create From scratch.
2. Enable **Socket Mode**. App-level token (`xapp-…`, scope `connections:write`)
   → `SLACK_APP_TOKEN`.
3. Bot scopes: `chat:write`, `im:history`, `im:read`, `im:write`,
   `files:read`, `files:write`, `app_mentions:read`. Add
   `channels:history` / `groups:history` only if you want channel mentions.
4. Event Subscriptions (no Request URL): `message.im`, `app_mention`.
5. Install → Bot User OAuth Token (`xoxb-…`) → `SLACK_BOT_TOKEN`.
6. Profile → Copy member ID → allowlist.

```bash
CHANNEL=slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_ALLOWED_USERS=U01234567
```

DMs stay flat; channel `@mention` replies land in a thread. Both tokens are
required (`xapp-` is not the bot token).

---

## Chat

Outbound WSS to this Worker's room. The harness dials; nothing listens.
There is no mailbox URL to paste — the Agent DO's origin is
`wss://<this origin>/ws/<slug>`, and the DO injects the bearer.
[architecture.md](architecture.md).

On dial the harness sends `aims` then `todo` after `cmds`, and sends either
frame again when a turn or a cron push changed those rows. A `todo` row
carries `priority` (`2` urgent, `1` high, absent when normal) with the
`!` marker stripped from `text`. The tasks write-up is not carried.
No new socket, no `gantry status` field, no HTTP route. The chat PWA
lands with [todo.md](todo.md) §3. Cab uses this same room. Android Auto
is one surface of that app. The harness uses `CHANNEL=chat`.

```bash
CHANNEL=chat
CHAT_BEARER=...
# Google sub, sub:email, or email — the DO injects this from config.env
CHAT_ALLOWED_USERS=118212345678901234567:ada@example.com, bob@example.com
```

Grant `image` and `chat` in `mcp.toml` and set `IMAGE_OUTPUT_DIR` (both
children inherit it) so the agent can draw a face or wallpaper and wear it
via `source_path`. Chat photos still go on the room reply; face and backdrop
are rows on the Agent DO (`avatar`, `backdrop`, ≤2 MB each), not bubbles. The `chat` plugin
lands with [todo.md](todo.md) §6.

The room announces `face` / `backdrop` / `theme` changes on the harness
socket too. The channel caches them (`Room()`), and when `chat` is in
the catalog the agent stamps `[room] theme ember (set 3h ago) · wallpaper
set 3h ago · face changed 2d ago — yours; redress when the hour or your
mood moves on` on every turn's `[harness]`. State plus one clause; the
tool descriptions carry the how. Prefix off for this chat → `— chat is
off this chat`. Fresh boot → `theme not seen since boot` (the room
flushes theme to phones on connect, not to the harness). The daily planner
reads the same line and redresses when it is stale.

Recreate the container after env changes (restart keeps a ghost allowlist).

| Entry | Parse |
| --- | --- |
| `118212345678901234567` | Google `sub` (digits) |
| `118212345678901234567:ada@example.com` | `sub` left of the first `:`, email right (lowercased) |
| `ada@example.com` | email only (lowercased) — alias until the `sub` is known |

The harness admits a frame when `user_id` **or** `email` is on the list. The
agent conversation is always `gantry` — email matches for admit, it never
keys memory, cron, or history. Session id on the wire is
`chat:<slug>:<sub>`. On dial the harness writes `cmds`, `aims`, `todo`, then `allow`.
Email-only rows learn the Google `sub` on first inbound (or silent pin) so
Push can target that phone; until then Push broadcasts to `role:phone`.
Settings may write emails into `CHAT_ALLOWED_USERS`
([contract.md](contract.md)).

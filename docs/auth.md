# Auth from chat

Google Workspace, Google Health, and Strava connect with an OAuth
redirect that lands on this Worker. Garmin is email, password, and
MFA. Nothing listens on your LAN. Pictures:
[architecture.md](architecture.md). The threat write-up:
[security.md](security.md).

Door sign-in and tool OAuth use one platform Google client (Settings
or deploy). Register both redirect URIs on that client:
`/api/auth/callback/google` for the door and `/api/auth/catch` for
chat Connect and `/auth` flows. They stay separate HTTP requests; only
the client id is shared.

---

## Redirect URIs

Google and Google Health register these on the client, exactly, with
no trailing slash. `PUBLIC_ORIGIN` (no path) overrides the host the
Worker prints. An unusable `PUBLIC_ORIGIN` does not fall through to
the request origin.

```text
https://gantree.bldhosting.com/api/auth/catch
http://127.0.0.1:3000/api/auth/catch
```

A home box uses its own public origin the same way:
`https://<host>/api/auth/catch`.

Strava does not register a full redirect URI. The API application
setting is Authorization Callback Domain: the hostname only
(`gantree.bldhosting.com`, or `localhost`). No scheme, no path, no
comma-separated list. `localhost` and `127.0.0.1` are whitelisted
for local dev. The redirect we send is still
`{origin}/api/auth/catch`. Pasting that full URI into the domain
field makes every authorize call return `redirect_uri` invalid.

Plugin names are the module names: `google`, `strava`,
`google-health`. Not `ghealth`.

---

## From chat

`/auth <plugin>` returns the provider URL. `state` on that URL is an
`oauth-catch` JWE (`sealOAuthCatch`, 30 minutes) holding
`{ slug, plugin }`. Open it, approve, and you land back here
connected. The room gets a reply: `<plugin> connected`.

`/auth google` and the Tools-fold Connect google button start the same
OAuth URL. A second login adds another Google Workspace mailbox. It
does not replace the first. The authorization URL asks Google to show
the account chooser (`prompt` includes `select_account` and `consent`)
so the second login can pick the other account.

The room reply stays `<plugin> connected`. The agent sees addresses
from the `auth_list_accounts` tool and passes `user_google_email` on
Workspace calls. Workspace is ready when any `google:<email>` token
exists.

`/auth google-health` stores provider id `google-health`. That token
is separate. A Health connect does not replace Workspace mailboxes.
Health is ready only when a `google-health` token exists.

---

## Connect on the Tools fold

`POST /api/agents/:slug/auth/start` with `{ plugin }` returns the same
URL. The dashboard Connect button uses that route. A plugin that is
not `google`, `google-health`, or `strava` is `400 bad_plugin`.

Connect google starts the same OAuth URL as `/auth google`. A second
login adds another Google Workspace mailbox. It does not replace the
first. Connect google-health stores provider id `google-health`. That
token is separate. A Health connect does not replace Workspace
mailboxes.

---

## The catch

`GET /api/auth/catch?state&code` is on the public list
(`lib/door/gate.ts`) so a missing cookie is a plain-text 401, not an
HTML login redirect. The handler still requires the `gantree_session`
cookie. The caller is an admin, or a member of that agent's room.
`state` is the same JWE. The Worker posts `{ plugin, code,
redirectUri, userId }` to that agent's DO (`X-Chat-Op: auth`). The
harness runs `authFinish` and the DO enqueues
`{ kind: reply, text: "<plugin> connected" }`.

Success body: `Connected <plugin>. Go back to chat.`

Misses: `login not configured` (503, no `SESSION_SECRET`), `bad state`
(400), `missing code` (400), `could not connect` (502).

The code is not written to the log. Refresh tokens land in
`oauth_token` in that DO, AES-256-GCM under `snapshot.key`.

Workspace refresh tokens are stored in `oauth_token` with provider id
`google:<email>` (lowercase email). Signing in again as the same
address replaces only that row. An existing provider id `google` (one
token, email on the blob) is promoted on next read to `google:<email>`
when the email is known, so the current account stays signed in.

`google-health` is its own row. A Health connect does not replace
Workspace mailboxes. Health records the email on the token blob. The
catch page success body stays `Connected <plugin>. Go back to chat.`

---

## Garmin

Garmin has no public OAuth. Put `GARMIN_EMAIL` and `GARMIN_PASSWORD`
on the agent, then `/auth garmin`. The vendor emails a code; paste it
with `/auth garmin <code>`. The code may be a text, an email, or an
authenticator code.

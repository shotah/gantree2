import { oauthCatchRedirect } from "@/lib/agents/oauth";
import { AGENT_SLUG } from "@/lib/agents/types";
import { fetchRoomUsers } from "@/lib/chat/allow";
import { agentStub, type AgentBinding } from "@/lib/chat/location";
import { roomAllows } from "@/lib/chat/room";
import { openOAuthCatch, openSession, readCookie, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { memoryStore, resolveUser, type UserStore, type UsersEnv } from "@/lib/door/users";

export type CatchEnv = AgentBinding & UsersEnv & {
  SESSION_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  ALLOWED_SUBS?: string;
};

const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const FAILURE_LINE = 240;

function plain(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pluginLabel(plugin: string): string {
  if (plugin === "google") {
    return "Google";
  }
  return plugin.charAt(0).toUpperCase() + plugin.slice(1);
}

/** Self-contained OAuth popup landing page (success or failure). */
export function oauthCatchLanding(opts: { ok: true; plugin: string } | { ok: false; reason: string }): string {
  const ok = opts.ok;
  const dataResult = ok ? "ok" : "fail";
  const icon = ok
    ? `<svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="44" fill="none" stroke="var(--ok)" stroke-width="4"/><path fill="none" stroke="var(--ok)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="M28 48 L42 62 L68 34"/></svg>`
    : `<svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="44" fill="none" stroke="var(--danger)" stroke-width="4"/><path fill="none" stroke="var(--danger)" stroke-width="5" stroke-linecap="round" d="M32 32 L64 64 M64 32 L32 64"/></svg>`;
  const heading = ok
    ? `${escapeHtml(pluginLabel(opts.plugin))} connected`
    : escapeHtml(opts.reason);
  const subline = ok ? "You can close this window and go back to chat." : "";
  const title = ok ? "Connected" : "Connection failed";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<meta name="theme-color" content="#0e1316"/>
<title>${escapeHtml(title)}</title>
<style>
:root{--canvas:#0e1316;--panel:#171d22;--line:#3a4550;--fg:#f4f0ea;--muted:#9aa3ab;--ok:#3db8a0;--danger:#e070a0;--track:#232b32}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--canvas);color:var(--fg);display:flex;align-items:center;justify-content:center;padding:1.5rem}
main{width:min(32rem,100%);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:2rem 1.5rem;text-align:center}
.icon{display:flex;justify-content:center;margin:0 0 1.25rem}
h1{font-size:1.35rem;margin:0 0 0.65rem;font-weight:600}
p{color:var(--muted);line-height:1.45;margin:0 0 1.5rem;font-size:1rem}
p.fail{color:var(--fg)}
button{appearance:none;border:1px solid var(--line);border-radius:8px;padding:0.65rem 1.25rem;font-size:0.95rem;font-weight:600;cursor:pointer;background:var(--track);color:var(--fg)}
button:hover{filter:brightness(1.08)}
.hint{margin:1rem 0 0;font-size:0.85rem;color:var(--muted)}
.hint[hidden]{display:none}
</style>
</head>
<body>
<main data-result="${dataResult}">
<div class="icon">${icon}</div>
<h1>${heading}</h1>
${subline ? `<p>${subline}</p>` : ""}
<button type="button" id="close-btn">Close</button>
<p class="hint" id="close-hint" hidden>If this window stays open, close it yourself.</p>
</main>
<script>
(function(){
  var hint=document.getElementById("close-hint");
  document.getElementById("close-btn").addEventListener("click",function(){
    window.close();
    if(hint)hint.hidden=false;
  });
})();
</script>
</body>
</html>`;
}

/**
 * `GET /api/auth/catch?state=…&code=…`. The path stays public so a missing
 * cookie is this HTML 401, not an HTML login redirect. `state` is an
 * `oauth-catch` JWE (`sealOAuthCatch`) holding `{ slug, plugin }`. The
 * signed-in user must be an admin or on that agent's room allow list.
 * The code is finished on that agent's DO (`X-Chat-Op: auth`), which posts
 * `<plugin> connected` into that user's room. When that DO is not OK, the
 * page is its JSON `message` (one line, at most 240 characters, status 502)
 * or `could not connect`. The code is not written into the page.
 */
export async function catchOAuth(
  request: Request,
  env: CatchEnv,
  store: UserStore = memoryStore(),
): Promise<Response> {
  if (request.method !== "GET") {
    return plain("method", 405);
  }
  const url = new URL(request.url);
  if (!env.SESSION_SECRET) {
    return html(oauthCatchLanding({ ok: false, reason: "login not configured" }), 503);
  }
  let key: Uint8Array;
  try {
    key = await sessionKey(env.SESSION_SECRET);
  } catch {
    return html(oauthCatchLanding({ ok: false, reason: "login not configured" }), 503);
  }
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    return html(oauthCatchLanding({ ok: false, reason: "unauthorized" }), 401);
  }
  const session = await openSession(key, token);
  if (!session) {
    return html(oauthCatchLanding({ ok: false, reason: "unauthorized" }), 401);
  }
  const who = await resolveUser(env, store, {
    sub: session.sub,
    email: session.email,
    emailVerified: Boolean(session.email),
  });
  if (!who) {
    return html(oauthCatchLanding({ ok: false, reason: "unauthorized" }), 401);
  }
  let claims: { slug: string; plugin: string } | null;
  try {
    claims = await openOAuthCatch(key, url.searchParams.get("state") ?? "");
  } catch {
    return html(oauthCatchLanding({ ok: false, reason: "login not configured" }), 503);
  }
  if (!claims || !AGENT_SLUG.test(claims.slug) || !PLUGIN_NAME.test(claims.plugin)) {
    return html(oauthCatchLanding({ ok: false, reason: "bad state" }), 400);
  }
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!code) {
    return html(oauthCatchLanding({ ok: false, reason: "missing code" }), 400);
  }
  const stub = agentStub(env, claims.slug);
  if (!stub) {
    return html(oauthCatchLanding({ ok: false, reason: "agent unavailable" }), 503);
  }
  if (who.role !== "admin") {
    const users = await fetchRoomUsers(stub);
    const allowed = roomAllows(users, {
      sub: session.sub,
      email: session.email ?? undefined,
      emailVerified: Boolean(session.email),
    }, env.ALLOWED_SUBS);
    if (!allowed) {
      return html(oauthCatchLanding({ ok: false, reason: "forbidden" }), 403);
    }
  }
  const redirectUri = oauthCatchRedirect(env, url.origin);
  if (!redirectUri) {
    return html(oauthCatchLanding({ ok: false, reason: "no origin" }), 503);
  }
  let res: Response;
  try {
    res = await stub.fetch(new Request("https://agent/auth", {
      method: "POST",
      headers: { "X-Chat-Op": "auth", "content-type": "application/json" },
      body: JSON.stringify({ plugin: claims.plugin, code, redirectUri, userId: session.sub }),
    }));
  } catch {
    return html(oauthCatchLanding({ ok: false, reason: "could not connect" }), 502);
  }
  if (!res.ok) {
    return html(oauthCatchLanding({ ok: false, reason: await failureText(res, code) }), 502);
  }
  return html(oauthCatchLanding({ ok: true, plugin: claims.plugin }));
}

/** DO `{ message }` as one line, or `could not connect` when there is nothing safe to show. */
async function failureText(res: Response, code: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    return "could not connect";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("message" in parsed)) {
    return "could not connect";
  }
  const message = parsed.message;
  if (typeof message !== "string") {
    return "could not connect";
  }
  return safeLine(message, code) || "could not connect";
}

function safeLine(message: string, code: string): string {
  let line = message;
  if (code) {
    line = line.split(code).join(" ");
    const encoded = encodeURIComponent(code);
    if (encoded !== code) {
      line = line.split(encoded).join(" ");
    }
  }
  let out = "";
  let gap = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x20) {
      gap = out.length > 0;
      continue;
    }
    if (gap) {
      out += " ";
      gap = false;
    }
    out += line.charAt(i);
  }
  if (out.length > FAILURE_LINE) {
    out = out.slice(0, FAILURE_LINE).trim();
  }
  return out;
}

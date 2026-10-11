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

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * `GET /api/auth/catch?state=…&code=…`. The path stays public so a missing
 * cookie is this plain-text 401, not an HTML login redirect. `state` is an
 * `oauth-catch` JWE (`sealOAuthCatch`) holding `{ slug, plugin }`. The
 * signed-in user must be an admin or on that agent's room allow list.
 * The code is finished on that agent's DO (`X-Chat-Op: auth`), which posts
 * `<plugin> connected` into that user's room.
 */
export async function catchOAuth(
  request: Request,
  env: CatchEnv,
  store: UserStore = memoryStore(),
): Promise<Response> {
  if (request.method !== "GET") {
    return text("method", 405);
  }
  const url = new URL(request.url);
  if (!env.SESSION_SECRET) {
    return text("login not configured", 503);
  }
  let key: Uint8Array;
  try {
    key = await sessionKey(env.SESSION_SECRET);
  } catch {
    return text("login not configured", 503);
  }
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    return text("unauthorized", 401);
  }
  const session = await openSession(key, token);
  if (!session) {
    return text("unauthorized", 401);
  }
  const who = await resolveUser(env, store, {
    sub: session.sub,
    email: session.email,
    emailVerified: Boolean(session.email),
  });
  if (!who) {
    return text("unauthorized", 401);
  }
  let claims: { slug: string; plugin: string } | null;
  try {
    claims = await openOAuthCatch(key, url.searchParams.get("state") ?? "");
  } catch {
    return text("login not configured", 503);
  }
  if (!claims || !AGENT_SLUG.test(claims.slug) || !PLUGIN_NAME.test(claims.plugin)) {
    return text("bad state", 400);
  }
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!code) {
    return text("missing code", 400);
  }
  const stub = agentStub(env, claims.slug);
  if (!stub) {
    return text("agent unavailable", 503);
  }
  if (who.role !== "admin") {
    const users = await fetchRoomUsers(stub);
    const allowed = roomAllows(users, {
      sub: session.sub,
      email: session.email ?? undefined,
      emailVerified: Boolean(session.email),
    }, env.ALLOWED_SUBS);
    if (!allowed) {
      return text("forbidden", 403);
    }
  }
  const redirectUri = oauthCatchRedirect(env, url.origin);
  if (!redirectUri) {
    return text("no origin", 503);
  }
  let res: Response;
  try {
    res = await stub.fetch(new Request("https://agent/auth", {
      method: "POST",
      headers: { "X-Chat-Op": "auth", "content-type": "application/json" },
      body: JSON.stringify({ plugin: claims.plugin, code, redirectUri, userId: session.sub }),
    }));
  } catch {
    return text("could not connect", 502);
  }
  if (!res.ok) {
    return text("could not connect", 502);
  }
  return text(`Connected ${claims.plugin}. Go back to chat.`);
}

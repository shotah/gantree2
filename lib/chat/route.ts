import { devIdentity } from "@/lib/door/gate";
import { fetchRoomUsers } from "./allow";
import { fetchRoomBearer } from "./bearer";
import { configError, forbidden, unauthorized } from "./deny";
import type { AgentEnv } from "./env";
import { hasGeo, hasImages, hasText, type FrameKind, type Role, type WireFrame } from "./frame";
import { shouldQueue } from "./queue";
import { roleTag, subTag } from "./tags";

const PHONE_KINDS = new Set<FrameKind>(["inbound", "pin", "ack", "react"]);

/** Phone may send inbound | pin | ack | react. Default inbound (text/images) or pin (geo-only). */
export function resolvePhoneKind(frame: WireFrame): FrameKind | undefined {
  if (frame.kind) {
    return PHONE_KINDS.has(frame.kind) ? frame.kind : undefined;
  }
  if (hasText(frame) || hasImages(frame)) {
    return "inbound";
  }
  if (hasGeo(frame)) {
    return "pin";
  }
  return undefined;
}

export function phoneKindAllowed(frame: WireFrame): boolean {
  return resolvePhoneKind(frame) != null;
}

/**
 * A `reply` with no words and no photo is not a turn. Refuse it so no mouth
 * paints an empty bubble, drops its draft, or replays a blank on hydrate.
 */
export function emptyReply(frame: WireFrame): boolean {
  return frame.kind === "reply" && !hasText(frame) && !hasImages(frame);
}

/**
 * Tag for `getWebSockets`. Prefixed so `user_id` cannot collide with role /
 * verified / email slots. Phone-originated frames go to the harness.
 * Harness `reply` requires `user_id`. Harness `push` with no `user_id` is all phones.
 * The wire role is still `crane`.
 */
export function routeTag(from: Role, frame: WireFrame): string | undefined {
  if (from === "phone") {
    return roleTag("crane");
  }
  if (frame.kind === "push") {
    return frame.user_id ? subTag(frame.user_id) : roleTag("phone");
  }
  if (frame.kind === "reply" || frame.kind === "typing" || frame.kind === "draft") {
    return frame.user_id ? subTag(frame.user_id) : undefined;
  }
  if (frame.kind === "error" && frame.user_id) {
    return subTag(frame.user_id);
  }
  return roleTag("phone");
}

/** Phone-bound frames always persist; harness-bound inbound persists only when no harness socket. */
export function persistRole(from: Role, kind?: FrameKind, userId?: string): Role | undefined {
  if (!shouldQueue(kind)) {
    return undefined;
  }
  if (from === "phone") {
    return "crane";
  }
  if (kind === "reply") {
    return userId ? "phone" : undefined;
  }
  if (kind === "push" || kind === "error") {
    return "phone";
  }
  return undefined;
}

/** Your inbound also lands on the phone queue (unread) and the transcript (reload). */
export function persistInboundForPhone(from: Role, kind?: FrameKind): boolean {
  return from === "phone" && kind === "inbound";
}

/** Live copy of Ada's inbound to her other open sockets. Not a reroute of the harness path. */
export function siblingPhoneTag(from: Role, kind?: FrameKind, userId?: string): string | undefined {
  if (from !== "phone" || kind !== "inbound") {
    return undefined;
  }
  const id = userId?.trim();
  if (!id) {
    return undefined;
  }
  return subTag(id);
}

export function exceptSender<T>(sockets: readonly T[], sender: T): T[] {
  return sockets.filter((s) => s !== sender);
}

import {
  handshake,
  handshakePhone,
  rateId,
  roleFromQuery,
  stampEmail,
  stampUserId,
} from "./handshake";
import { agentStub } from "./location";
import { resolveAuthMode } from "./mode";
import { phoneAdmitted } from "./floor";
import { slugFromPath } from "./slug";
import { stampAgentHeaders, upgradeOriginOk } from "./upgrade";

export { slugFromPath };

/**
 * `GET /ws/<slug>?role=phone|crane` (role `agent` is the same harness role).
 *
 * `worker/index.ts` must call this **before** the Vinext handler. Middleware
 * treats `/ws/*` as an API and 401s a request with no session cookie, which
 * would refuse the harness bearer.
 *
 * ```ts
 * if (url.pathname.startsWith("/ws/")) {
 *   const routed = await routeAgentSocket(request, env, slugFromPath(url.pathname));
 *   return routed ?? new Response("not found", { status: 404 });
 * }
 * ```
 *
 * Returns null only when `slug` is missing. Every other case is a Response
 * (404 bad role, 403 origin, 401/403 auth, 503 config, or the DO's 101).
 */
export async function routeAgentSocket(
  req: Request,
  env: AgentEnv,
  slug: string | null,
): Promise<Response | null> {
  if (!slug) {
    return null;
  }
  const url = new URL(req.url);
  const role = roleFromQuery(url.searchParams.get("role"));
  if (!role) {
    return new Response("not found", { status: 404 });
  }
  if (!upgradeOriginOk(req.headers.get("Origin"), url.origin)) {
    return new Response("forbidden", { status: 403 });
  }
  const stub = agentStub(env, slug);
  const dev = role === "phone" ? devIdentity(env, url) : null;
  const mode = resolveAuthMode(env, url.hostname);
  if (!mode.ok && !dev) {
    return configError();
  }
  const authMode = mode.ok ? mode.mode : "oidc";
  const auth = dev
    ? await devPhone(env, stub, dev)
    : role === "phone"
      ? await handshakePhone({
          env,
          slug,
          cookieHeader: req.headers.get("Cookie"),
          authorization: req.headers.get("Authorization"),
          querySecret: url.searchParams.get("secret"),
          host: url.hostname,
          loadRoom: async () => (stub ? fetchRoomUsers(stub) : []),
        })
      : await handshake({
          env,
          slug,
          role,
          authorization: req.headers.get("Authorization"),
          queryBearer: url.searchParams.get("bearer"),
          host: url.hostname,
          roomBearer: stub ? await fetchRoomBearer(stub) : null,
        });
  if (!auth.ok) {
    if (auth.error === "config") {
      return configError();
    }
    if (auth.error === "forbidden") {
      return forbidden();
    }
    return unauthorized();
  }
  if (!stub) {
    return new Response("not found", { status: 404 });
  }
  const headers = stampAgentHeaders(req, {
    role,
    rateId: rateId(authMode, auth.principal),
    slug,
    userId: stampUserId(auth.principal),
    email: stampEmail(auth.principal),
    emailVerified: auth.principal.kind === "phone" && auth.principal.emailVerified,
    exp: auth.principal.kind === "phone" ? auth.principal.exp : undefined,
  });
  return stub.fetch(new Request(req, { headers }));
}

async function devPhone(
  env: AgentEnv,
  stub: DurableObjectStub | null,
  dev: { sub: string; email: string | null },
): Promise<Awaited<ReturnType<typeof handshake>>> {
  const roomList = stub ? await fetchRoomUsers(stub) : [];
  const session = {
    sub: dev.sub,
    email: dev.email ?? undefined,
    emailVerified: Boolean(dev.email),
  };
  if (!phoneAdmitted(roomList, session, env)) {
    return { ok: false, error: "forbidden" };
  }
  return {
    ok: true,
    principal: {
      kind: "phone",
      sub: dev.sub,
      email: session.email,
      emailVerified: session.emailVerified,
    },
  };
}

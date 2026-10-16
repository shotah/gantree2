import { devIdentity } from "@/lib/door/gate";
import { memoryStore, resolveUser } from "@/lib/door/users";
import type { UserStore } from "@/lib/door/users";
import {
  doorUserForRequest,
  humanChatPrecheck,
  memberInDirectory,
  memberRoomUsersWhenNeeded,
  inventoriedAgent,
} from "./admission";
import type { RoomUser } from "./allow";
import { fetchRoomBearer } from "./bearer";
import { agentOff, configError, forbidden, unauthorized } from "./deny";
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
  store: UserStore = memoryStore(),
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
  const dev = role === "phone" ? devIdentity(env, url) : null;
  const mode = resolveAuthMode(env, url.hostname);
  if (!mode.ok && !dev) {
    return configError();
  }
  const authMode = mode.ok ? mode.mode : "oidc";
  const inventoried = await inventoriedAgent(env, slug);
  if (!inventoried) {
    return new Response("not found", { status: 404 });
  }
  if (!inventoried.enabled) {
    return agentOff();
  }

  let roomList: readonly RoomUser[] = [];
  let admit: Parameters<typeof handshake>[0]["admit"];
  let doorUser: Awaited<ReturnType<typeof doorUserForRequest>> = null;

  if (dev && role === "phone") {
    doorUser = await resolveUser(env, store, { sub: dev.sub, email: dev.email, emailVerified: true });
    if (!doorUser) {
      return unauthorized();
    }
    const session = {
      sub: doorUser.entry.sub ?? dev.sub,
      email: doorUser.entry.email ?? dev.email ?? undefined,
      emailVerified: Boolean(doorUser.entry.email ?? dev.email),
    };
    const pre = humanChatPrecheck(env, doorUser, slug, session);
    if (pre === "forbidden") {
      return forbidden();
    }
    const inDirectory = doorUser.role === "member" && await memberInDirectory(env, session, slug);
    roomList = await memberRoomUsersWhenNeeded(env, slug, doorUser.role, inDirectory);
    if (!phoneAdmitted(roomList, session, env, {
      role: doorUser.role,
      assignedSlugs: doorUser.agents,
      slug,
      inDirectory,
    })) {
      return forbidden();
    }
    const stub = agentStub(env, slug);
    if (!stub) {
      return new Response("not found", { status: 404 });
    }
    const headers = stampAgentHeaders(req, {
      role,
      rateId: `sub:${session.sub}`,
      slug,
      userId: session.sub,
      email: session.email,
      emailVerified: session.emailVerified,
      doorRole: doorUser.role,
      assignedAgents: doorUser.agents,
    });
    return stub.fetch(new Request(req, { headers }));
  }

  if (role === "phone" && authMode === "oidc") {
    doorUser = await doorUserForRequest(env, req, store);
    if (doorUser) {
      const session = {
        sub: doorUser.entry.sub ?? "",
        email: doorUser.entry.email ?? undefined,
        emailVerified: Boolean(doorUser.entry.email),
      };
      const pre = humanChatPrecheck(env, doorUser, slug, session);
      if (pre === "forbidden") {
        return forbidden();
      }
      const inDirectory = doorUser.role === "member" && await memberInDirectory(env, session, slug);
      roomList = await memberRoomUsersWhenNeeded(env, slug, doorUser.role, inDirectory);
      admit = { role: doorUser.role, assignedSlugs: doorUser.agents, slug, inDirectory };
    }
  }

  const auth = authMode === "spike"
    ? await handshake({
        env,
        slug,
        role,
        cookieHeader: req.headers.get("Cookie"),
        authorization: req.headers.get("Authorization"),
        querySecret: url.searchParams.get("secret"),
        host: url.hostname,
      })
    : role === "phone"
      ? await handshake({
          env,
          slug,
          role: "phone",
          cookieHeader: req.headers.get("Cookie"),
          authorization: req.headers.get("Authorization"),
          querySecret: url.searchParams.get("secret"),
          host: url.hostname,
          roomList,
          admit,
        })
      : await handshake({
          env,
          slug,
          role,
          authorization: req.headers.get("Authorization"),
          queryBearer: url.searchParams.get("bearer"),
          host: url.hostname,
          roomBearer: await (async () => {
            const craneStub = agentStub(env, slug);
            return craneStub ? fetchRoomBearer(craneStub) : null;
          })(),
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
  const stub = agentStub(env, slug);
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
    doorRole: doorUser?.role,
    assignedAgents: doorUser?.agents,
  });
  return stub.fetch(new Request(req, { headers }));
}

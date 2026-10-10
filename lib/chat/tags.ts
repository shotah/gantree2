import type { Role } from "./frame";
import { parseEmailVerified, parseExpMs } from "./socketAuth";

export const ROLE_PHONE = "role:phone";
/** Socket tag for the harness. The value stays `role:crane` — that is the wire role the harness dials. */
export const ROLE_AGENT = "role:crane";
export const WS_OPEN = 1;

export type SocketMeta = {
  role: Role;
  rateId: string;
  userId?: string;
  expMs?: number;
  email?: string;
  emailVerified?: boolean;
};

export function roleTag(role: Role): string {
  return role === "crane" ? ROLE_AGENT : ROLE_PHONE;
}

export function subTag(userId: string): string {
  return `sub:${userId}`;
}

/** Tags that `getWebSockets` may match after a deploy (prefixed + leftover positional). */
export function tagAliases(tag: string): string[] {
  if (tag === ROLE_PHONE) {
    return [ROLE_PHONE, "phone"];
  }
  if (tag === ROLE_AGENT) {
    return [ROLE_AGENT, "crane"];
  }
  if (tag.startsWith("sub:") && tag.length > 4) {
    return [tag, tag.slice(4)];
  }
  return [tag];
}

export function collectTagged<T>(get: (tag: string) => readonly T[], tag: string): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const name of tagAliases(tag)) {
    for (const ws of get(name)) {
      if (!seen.has(ws)) {
        seen.add(ws);
        out.push(ws);
      }
    }
  }
  return out;
}

export function isSocketOpen(ws: { readyState: number }): boolean {
  return ws.readyState === WS_OPEN;
}

export function openSockets<T extends { readyState: number }>(sockets: readonly T[]): T[] {
  return sockets.filter(isSocketOpen);
}

export type Sendable = { readyState: number; send(body: string): void };

/**
 * Fan one body to every open socket. `getWebSockets` can still list a socket
 * that is CLOSING (Cab's `cancel()`ed sweep socket, a hidden PWA tab, a 4401),
 * and `send()` on one throws — an unguarded loop would starve every peer after
 * it and drop the crane's frame. Returns the sockets that took the body.
 */
export function fanOut<T extends Sendable>(sockets: readonly T[], body: string): T[] {
  const sent: T[] = [];
  for (const ws of openSockets(sockets)) {
    try {
      ws.send(body);
      sent.push(ws);
    } catch {
      // stale: closed under us between the readyState check and the write
    }
  }
  return sent;
}

/** Queue inbound for the crane only when no live crane socket is open. */
export function queueForAgent(openPeerCount: number): boolean {
  return openPeerCount < 1;
}

export function socketTags(meta: SocketMeta): string[] {
  const tags = [roleTag(meta.role), `rate:${meta.rateId || "anon"}`];
  if (meta.userId) {
    tags.push(subTag(meta.userId));
  }
  if (meta.expMs != null && meta.expMs > 0) {
    tags.push(`exp:${meta.expMs}`);
  }
  if (meta.email) {
    tags.push(`email:${meta.email}`);
  }
  if (meta.emailVerified) {
    tags.push("verified:1");
  }
  return tags;
}

function prefixed(tags: readonly string[]): boolean {
  return tags.some((t) => (
    t.startsWith("role:") || t.startsWith("rate:") || t.startsWith("sub:")
  ));
}

export function parseSocketTags(tags: readonly string[]): SocketMeta {
  if (!prefixed(tags)) {
    const role = tags[0] === "crane" ? "crane" : "phone";
    return {
      role,
      rateId: tags[1] || "anon",
      userId: tags[2] || undefined,
      expMs: parseExpMs(tags[3]),
      email: tags[4] || undefined,
      emailVerified: parseEmailVerified(tags[5]),
    };
  }
  let role: Role = "phone";
  let rateId = "anon";
  let userId: string | undefined;
  let expMs: number | undefined;
  let email: string | undefined;
  let emailVerified = false;
  for (const tag of tags) {
    if (tag === ROLE_AGENT) {
      role = "crane";
    } else if (tag === ROLE_PHONE) {
      role = "phone";
    } else if (tag.startsWith("rate:")) {
      rateId = tag.slice(5) || "anon";
    } else if (tag.startsWith("sub:")) {
      userId = tag.slice(4) || undefined;
    } else if (tag.startsWith("exp:")) {
      expMs = parseExpMs(tag.slice(4));
    } else if (tag.startsWith("email:")) {
      email = tag.slice(6) || undefined;
    } else if (tag === "verified:1") {
      emailVerified = true;
    }
  }
  return { role, rateId, userId, expMs, email, emailVerified };
}

import { phoneAdmitted, type PhoneAdmitEnv } from "@/lib/chat/floor";
import type { RoomUser } from "@/lib/chat/allow";
import { parseSlug } from "@/lib/chat/slug";
import { decodeBase64Url } from "./vapid";

export const PUSH_STORE_PREFIX = "p:";
export const PUSH_PER_USER = 8;
export const PUSH_ENDPOINT_MAX = 4_096;

export type PushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type StoredPush = {
  userId: string;
  email?: string;
  emailVerified?: boolean;
  subscription: PushSub;
  at: number;
};

/** Browser push hosts only. A listed human must not point the Worker at a URL. */
const PUSH_HOSTS_EXACT = new Set([
  "fcm.googleapis.com",
  "fcmregistrations.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
]);

function hostSuffix(host: string, parent: string): boolean {
  return host === parent || host.endsWith(`.${parent}`);
}

export function pushHostAllowed(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h || !/[a-z]/.test(h) || h.startsWith(".") || h.includes("..") || h.includes(":")) {
    return false;
  }
  if (PUSH_HOSTS_EXACT.has(h)) {
    return true;
  }
  if (hostSuffix(h, "push.apple.com")) {
    return true;
  }
  if (hostSuffix(h, "push.services.mozilla.com")) {
    return true;
  }
  if (hostSuffix(h, "notify.windows.com")) {
    return true;
  }
  return false;
}

export function parseHttpsEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const s = raw.trim();
  if (s.length < 12 || s.length > PUSH_ENDPOINT_MAX) {
    return null;
  }
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    if (!pushHostAllowed(url.hostname)) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function parsePushSub(raw: unknown): PushSub | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const endpoint = parseHttpsEndpoint(o.endpoint);
  const keys = o.keys && typeof o.keys === "object"
    ? o.keys as Record<string, unknown>
    : null;
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys?.auth === "string" ? keys.auth.trim() : "";
  const pub = decodeBase64Url(p256dh);
  const secret = decodeBase64Url(auth);
  if (!endpoint || !pub || pub.byteLength !== 65 || pub[0] !== 0x04) {
    return null;
  }
  if (!secret || secret.byteLength !== 16) {
    return null;
  }
  return { endpoint, keys: { p256dh, auth } };
}

export function parsePushPut(raw: unknown): { slug: string; subscription: PushSub } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const slug = typeof o.slug === "string" ? parseSlug(o.slug) : null;
  const subscription = parsePushSub(o.subscription);
  if (!slug || !subscription) {
    return null;
  }
  return { slug, subscription };
}

export function parsePushDelete(raw: unknown): { slug: string; endpoint: string } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const slug = typeof o.slug === "string" ? parseSlug(o.slug) : null;
  const endpoint = parseHttpsEndpoint(o.endpoint);
  if (!slug || !endpoint) {
    return null;
  }
  return { slug, endpoint };
}

/** `POST /api/push` — send a real test card to everything stored for this human in the room. */
export function parsePushTest(raw: unknown): { slug: string } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const slug = typeof o.slug === "string" ? parseSlug(o.slug) : null;
  return slug ? { slug } : null;
}

export function endpointHash(endpoint: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < endpoint.length; i++) {
    h ^= endpoint.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function pushStoreKey(userId: string, endpoint: string): string {
  return `${PUSH_STORE_PREFIX}${userId}:${endpointHash(endpoint)}`;
}

export function upsertPush(items: StoredPush[], next: StoredPush): StoredPush[] {
  const uid = next.userId;
  const mine = items.filter((p) => p.userId === uid);
  const others = items.filter((p) => p.userId !== uid);
  const stacked = [
    ...mine.filter((p) => p.subscription.endpoint !== next.subscription.endpoint),
    next,
  ].sort((a, b) => a.at - b.at || a.subscription.endpoint.localeCompare(b.subscription.endpoint));
  while (stacked.length > PUSH_PER_USER) {
    stacked.shift();
  }
  return [...others, ...stacked];
}

export function dropPush(items: StoredPush[], userId: string, endpoint: string): StoredPush[] {
  return items.filter((p) => p.userId !== userId || p.subscription.endpoint !== endpoint);
}

export function prunePushForRoom(
  items: StoredPush[],
  roomUsers: readonly RoomUser[],
  env?: PhoneAdmitEnv,
): StoredPush[] {
  return items.filter((p) => phoneAdmitted(roomUsers, {
    sub: p.userId,
    email: p.email,
    emailVerified: p.emailVerified,
  }, env ?? {}));
}

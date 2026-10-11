import { parseSlug } from "./slug";

export const ALLOW_STORE_KEY = "allow";
export const SLUG_STORE_KEY = "slug";
export const ALLOW_USERS_MAX = 64;

const SUB_RE = /^\d{10,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
const EMAIL_MAX = 254;

export type RoomUser = { sub?: string; email?: string };

export function phoneMustNotPublishAllow(role: "phone" | "crane", kind?: string): boolean {
  return role === "phone" && kind === "allow";
}

export function agentPublishedAllow(role: "phone" | "crane", kind?: string): boolean {
  return role === "crane" && kind === "allow";
}

function parseAllowUser(raw: unknown): RoomUser | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const subRaw = typeof o.sub === "string" ? o.sub.trim() : "";
  const emailRaw = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  const user: RoomUser = {};
  if (SUB_RE.test(subRaw)) {
    user.sub = subRaw;
  }
  if (emailRaw.length <= EMAIL_MAX && EMAIL_RE.test(emailRaw)) {
    user.email = emailRaw;
  }
  if (!user.sub && !user.email) {
    return null;
  }
  return user;
}

/** Untrusted wire → room list. Invalid entries are dropped. Cap 64. */
export function parseAllowUsers(raw: unknown): RoomUser[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: RoomUser[] = [];
  const seenSub = new Set<string>();
  const seenEmail = new Set<string>();
  for (const item of raw) {
    if (out.length >= ALLOW_USERS_MAX) {
      break;
    }
    const user = parseAllowUser(item);
    if (!user) {
      continue;
    }
    if (user.sub && seenSub.has(user.sub)) {
      continue;
    }
    if (user.email && seenEmail.has(user.email)) {
      continue;
    }
    if (user.sub) {
      seenSub.add(user.sub);
    }
    if (user.email) {
      seenEmail.add(user.email);
    }
    out.push(user);
  }
  return out;
}

export async function fetchRoomUsers(
  stub: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
): Promise<RoomUser[]> {
  try {
    const res = await stub.fetch(new Request("https://agent/allow", {
      method: "GET",
      headers: { "X-Chat-Op": "allow" },
    }));
    if (!res.ok) {
      return [];
    }
    const json: unknown = await res.json();
    if (!json || typeof json !== "object") {
      return [];
    }
    return parseAllowUsers((json as { users?: unknown }).users);
  } catch {
    return [];
  }
}

export function parseStoredSlug(raw: unknown): string | null {
  return typeof raw === "string" ? parseSlug(raw) : null;
}

export const ALLOW_HASH_KEY = "allow.hash";

export function allowHash(users: readonly RoomUser[]): string {
  return JSON.stringify(users);
}

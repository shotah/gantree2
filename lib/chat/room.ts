import type { RoomUser } from "./allow";

export type RoomSession = {
  sub: string;
  email?: string;
  emailVerified?: boolean;
};

/** `ALLOWED_SUBS`: `sub` or `sub:email`. `sub` is the key; any non-empty sub counts. */
export function extraSubs(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) {
    return map;
  }
  for (const part of raw.split(/[,\s]+/)) {
    const bit = part.trim();
    if (!bit) {
      continue;
    }
    const colon = bit.indexOf(":");
    const sub = (colon >= 0 ? bit.slice(0, colon) : bit).trim();
    const email = colon >= 0 ? bit.slice(colon + 1).trim() : "";
    if (!sub || map.has(sub)) {
      continue;
    }
    map.set(sub, email);
  }
  return map;
}

/**
 * Admit when `sub` is on the room list, or verified email matches, or
 * `sub` is on the optional static `ALLOWED_SUBS` extra. Empty list
 * admits nobody — extra is not a fallback that opens the door.
 */
export function roomAllows(
  list: readonly RoomUser[] | undefined,
  session: RoomSession,
  extra?: string,
): boolean {
  if (session.sub && extraSubs(extra).has(session.sub)) {
    return true;
  }
  const email = session.email?.trim().toLowerCase() ?? "";
  const verified = session.emailVerified === true && Boolean(email);
  for (const row of list ?? []) {
    if (session.sub && row.sub && row.sub === session.sub) {
      return true;
    }
    if (verified && row.email && row.email === email) {
      return true;
    }
  }
  return false;
}

export function phonesToClose<T extends RoomSession>(
  phones: readonly T[],
  list: readonly RoomUser[],
  extra?: string,
): T[] {
  return phones.filter((phone) => !roomAllows(list, phone, extra));
}

import type { RoomUser } from "./allow";
import { roomAllows, type RoomSession } from "./room";
import { parseSlug } from "./slug";

export function directorySubKey(sub: string): string {
  return `sub:${sub}`;
}

export function directoryEmailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

export function parseSlugSet(raw: string | null | undefined): Set<string> {
  if (!raw?.trim()) {
    return new Set();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const out = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") {
        continue;
      }
      const slug = parseSlug(item);
      if (slug) {
        out.add(slug);
      }
    }
    return out;
  } catch {
    return new Set();
  }
}

export function encodeSlugSet(slugs: Iterable<string>): string {
  return JSON.stringify([...new Set(slugs)].sort());
}

export type DirectoryDiff = {
  addSubs: string[];
  dropSubs: string[];
  addEmails: string[];
  dropEmails: string[];
};

function keysFrom(users: readonly RoomUser[]): { subs: Set<string>; emails: Set<string> } {
  const subs = new Set<string>();
  const emails = new Set<string>();
  for (const row of users) {
    if (row.sub) {
      subs.add(row.sub);
    }
    if (row.email) {
      emails.add(row.email);
    }
  }
  return { subs, emails };
}

export function directoryDiff(
  prev: readonly RoomUser[],
  next: readonly RoomUser[],
): DirectoryDiff {
  const before = keysFrom(prev);
  const after = keysFrom(next);
  return {
    addSubs: [...after.subs].filter((s) => !before.subs.has(s)).sort(),
    dropSubs: [...before.subs].filter((s) => !after.subs.has(s)).sort(),
    addEmails: [...after.emails].filter((s) => !before.emails.has(s)).sort(),
    dropEmails: [...before.emails].filter((s) => !after.emails.has(s)).sort(),
  };
}

export function directoryIdle(prev: readonly RoomUser[], next: readonly RoomUser[]): boolean {
  const diff = directoryDiff(prev, next);
  return (
    diff.addSubs.length === 0
    && diff.dropSubs.length === 0
    && diff.addEmails.length === 0
    && diff.dropEmails.length === 0
  );
}

export type DirectoryKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

async function addSlug(kv: DirectoryKv, key: string, slug: string): Promise<void> {
  const cur = parseSlugSet(await kv.get(key));
  cur.add(slug);
  await kv.put(key, encodeSlugSet(cur));
}

async function dropSlug(kv: DirectoryKv, key: string, slug: string): Promise<void> {
  const cur = parseSlugSet(await kv.get(key));
  cur.delete(slug);
  if (cur.size === 0) {
    await kv.delete(key);
    return;
  }
  await kv.put(key, encodeSlugSet(cur));
}

/** Rewrite this slug onto current keys; pull it off keys the new frame dropped. */
export async function directoryApply(
  kv: DirectoryKv,
  slug: string,
  prev: readonly RoomUser[],
  next: readonly RoomUser[],
): Promise<void> {
  const name = parseSlug(slug);
  if (!name) {
    return;
  }
  if (prev.length && directoryIdle(prev, next)) {
    return;
  }
  const diff = directoryDiff(prev, next);
  const current = keysFrom(next);
  for (const sub of current.subs) {
    await addSlug(kv, directorySubKey(sub), name);
  }
  for (const email of current.emails) {
    await addSlug(kv, directoryEmailKey(email), name);
  }
  for (const sub of diff.dropSubs) {
    await dropSlug(kv, directorySubKey(sub), name);
  }
  for (const email of diff.dropEmails) {
    await dropSlug(kv, directoryEmailKey(email), name);
  }
}

export async function agentsFor(
  kv: DirectoryKv,
  sub: string,
  email?: string,
): Promise<string[]> {
  const keys = [directorySubKey(sub)];
  if (email?.trim()) {
    keys.push(directoryEmailKey(email));
  }
  const sets = await Promise.all(keys.map(async (key) => parseSlugSet(await kv.get(key))));
  const all = new Set<string>();
  for (const set of sets) {
    for (const slug of set) {
      all.add(slug);
    }
  }
  return [...all].sort();
}

/** Re-index this slug's current room onto KV (harness reconnect). Adds only. */
export async function directoryRemember(
  kv: DirectoryKv | null | undefined,
  slug: string,
  users: readonly RoomUser[],
): Promise<boolean> {
  if (!kv || !users.length) {
    return true;
  }
  try {
    await directoryApply(kv, slug, [], users);
    return true;
  } catch {
    return false;
  }
}

export type RoomLookup = (slug: string) => Promise<RoomUser[]>;

/**
 * Agents this session may join: KV directory plus each candidate slug's
 * room. A typed slug is a candidate; it is not membership.
 */
export async function admittedAgents(opts: {
  kv?: DirectoryKv | null;
  slugs: Iterable<string>;
  session: RoomSession;
  extraSubs?: string;
  rooms: RoomLookup;
}): Promise<string[]> {
  const fromKv = opts.kv
    ? await agentsFor(opts.kv, opts.session.sub, opts.session.email)
    : [];
  const out = new Set(fromKv);
  const candidates = new Set<string>();
  for (const raw of opts.slugs) {
    const slug = parseSlug(raw);
    if (slug) {
      candidates.add(slug);
    }
  }
  await Promise.all([...candidates].map(async (slug) => {
    if (out.has(slug)) {
      return;
    }
    const users = await opts.rooms(slug);
    if (roomAllows(users, opts.session, opts.extraSubs)) {
      out.add(slug);
    }
  }));
  return [...out].sort();
}

/**
 * `/api/auth/me` room list. `agents` is the name; `cranes` is the alias copy
 * cab and helm still read. Same slugs, two fields, until the cutover.
 */
export function roomMembership(slugs: readonly string[]): { agents: string[]; cranes: string[] } {
  const agents = [...slugs];
  return { agents, cranes: [...agents] };
}

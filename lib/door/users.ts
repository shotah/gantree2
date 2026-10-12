import { type AllowEntry, type Identity, entryMatches, formatEntry, parseAllowlist } from "./allowlist";

/**
 * Who may be here, and what they may touch.
 *
 *   admin     users, settings, agents console, every inventoried agent
 *   operator  chat only for slugs on their row (inventory ∩ agents[])
 *   member    sign in; chat where the room list admits them (inventory only)
 *
 * Env is the floor: GANTREE_ADMINS and GANTREE_ALLOW are applied on every
 * request and can never be removed from the UI. Stored users come from a
 * UserStore (the Settings Durable Object). Role is computed per request —
 * never trusted from the cookie — so a removed row is a 401 on the next hit.
 */
export type Role = "admin" | "operator" | "member";

export type UserRow = {
  entry: AllowEntry;
  role: Role;
  /** Agent slugs an operator may run. Ignored for admin (all) and member (none). */
  agents: string[];
  /** True when the row comes from env. Shown locked in the UI. */
  locked: boolean;
};

export type UserStore = {
  list(): Promise<UserRow[]>;
};

export type UsersEnv = {
  GANTREE_ADMINS?: string;
  GANTREE_ALLOW?: string;
};

export type Resolved = {
  role: Role;
  agents: string[];
  entry: AllowEntry;
};

export const RANK: Record<Role, number> = { admin: 3, operator: 2, member: 1 };

export function envUsers(env: UsersEnv): UserRow[] {
  const admins = parseAllowlist(env.GANTREE_ADMINS).map<UserRow>((entry) => ({ entry, role: "admin", agents: [], locked: true }));
  const adminKeys = new Set(admins.map((r) => formatEntry(r.entry)));
  const members = parseAllowlist(env.GANTREE_ALLOW)
    .filter((entry) => !adminKeys.has(formatEntry(entry)))
    .map<UserRow>((entry) => ({ entry, role: "member", agents: [], locked: true }));
  return [...admins, ...members];
}

/** Fail closed: a deploy with no admins must not open. */
export function hasAdmins(env: UsersEnv): boolean {
  return parseAllowlist(env.GANTREE_ADMINS).length > 0;
}

export const memoryStore = (rows: UserRow[] = []): UserStore => ({
  list: () => Promise.resolve(rows),
});

/**
 * Highest role wins across every row that matches. Operator agents are the
 * union of matching operator rows. A miss is null — one shape for every miss.
 */
export function resolveFrom(rows: UserRow[], who: Identity): Resolved | null {
  let best: Resolved | null = null;
  const agents = new Set<string>();
  for (const row of rows) {
    if (!entryMatches(row.entry, who)) {
      continue;
    }
    if (row.role === "operator") {
      for (const slug of row.agents) {
        agents.add(slug);
      }
    }
    if (!best || RANK[row.role] > RANK[best.role]) {
      best = { role: row.role, agents: [], entry: row.entry };
    }
  }
  if (!best) {
    return null;
  }
  return { ...best, agents: best.role === "operator" ? [...agents].sort() : [] };
}

export async function resolveUser(env: UsersEnv, store: UserStore, who: Identity): Promise<Resolved | null> {
  const rows = [...envUsers(env), ...(await store.list())];
  return resolveFrom(rows, who);
}

export function canRunAgent(user: Resolved, slug: string): boolean {
  return user.role === "admin" || (user.role === "operator" && user.agents.includes(slug));
}

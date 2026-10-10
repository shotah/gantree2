/**
 * `/api/users` as HTTP. Pure request → response given env + store, same shape
 * as `lib/door/http.ts`. Admin only: the gate, then the role on `/api/auth/me`.
 */
import { formatEntry, parseEntry } from "./allowlist";
import { guard, json, me, type DoorEnv } from "./http";
import { hasUserMutations, type PutOutcome, type UserMutations } from "./settingsStore";
import { envUsers, type UserRow, type UserStore, type UsersEnv } from "./users";

const STATUS: Record<string, number> = {
  bad_json: 400,
  bad_entry: 400,
  bad_role: 400,
  bad_agents: 400,
  locked: 409,
  not_found: 404,
  forbidden: 403,
  settings_unavailable: 503,
};

function fail(error: keyof typeof STATUS): Response {
  return json({ error }, STATUS[error]);
}

function envKeys(env: UsersEnv): Set<string> {
  return new Set(envUsers(env).map((row) => formatEntry(row.entry)));
}

export function mergeUsers(env: UsersEnv, stored: UserRow[]): UserRow[] {
  const floor = envUsers(env);
  const keys = new Set(floor.map((row) => formatEntry(row.entry)));
  const rest = stored.filter((row) => {
    const key = formatEntry(row.entry);
    return key.length > 0 && !keys.has(key);
  });
  return [...floor, ...rest];
}

async function requireAdmin(req: Request, env: DoorEnv, store: UserStore): Promise<{ sub: string } | Response> {
  const blocked = await guard(req, env, store);
  if (blocked) {
    return blocked;
  }
  const profile = await me(req, env, store);
  if (!profile.ok) {
    return profile;
  }
  const body = await profile.json() as { sub?: unknown; role?: unknown };
  if (body.role !== "admin" || typeof body.sub !== "string" || body.sub.length === 0) {
    return fail("forbidden");
  }
  return { sub: body.sub };
}

function isResponse(value: { sub: string } | Response): value is Response {
  return value instanceof Response;
}

function mutations(store: UserStore): (UserStore & UserMutations) | null {
  return hasUserMutations(store) ? store : null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/users → env floor (locked) plus stored rows, and the recent audit. */
export async function getUsers(req: Request, env: DoorEnv, store: UserStore): Promise<Response> {
  const admin = await requireAdmin(req, env, store);
  if (isResponse(admin)) {
    return admin;
  }
  const api = mutations(store);
  const stored = await store.list();
  const audit = api ? await api.audit(50) : [];
  return json({ users: mergeUsers(env, stored), audit });
}

/** POST /api/users → add or update `{ entry, role, agents }`. Writes an audit row. */
export async function postUser(req: Request, env: DoorEnv, store: UserStore): Promise<Response> {
  const admin = await requireAdmin(req, env, store);
  if (isResponse(admin)) {
    return admin;
  }
  const api = mutations(store);
  if (!api) {
    return fail("settings_unavailable");
  }
  const body = await readJson(req);
  if (!body) {
    return fail("bad_json");
  }
  if (typeof body.entry !== "string") {
    return fail("bad_entry");
  }
  const parsed = parseEntry(body.entry);
  if (!parsed) {
    return fail("bad_entry");
  }
  if (envKeys(env).has(formatEntry(parsed))) {
    return fail("locked");
  }
  const outcome: PutOutcome = await api.putUser(
    { entry: formatEntry(parsed), role: body.role, agents: body.agents },
    admin.sub,
  );
  if (!outcome.ok) {
    return fail(outcome.error);
  }
  return json({ user: outcome.user });
}

/** DELETE /api/users/:entry → drop a stored row. Env rows stay. */
export async function deleteUser(req: Request, env: DoorEnv, store: UserStore, entry: string): Promise<Response> {
  const admin = await requireAdmin(req, env, store);
  if (isResponse(admin)) {
    return admin;
  }
  const api = mutations(store);
  if (!api) {
    return fail("settings_unavailable");
  }
  const parsed = parseEntry(entry);
  if (!parsed) {
    return fail("bad_entry");
  }
  const key = formatEntry(parsed);
  if (envKeys(env).has(key)) {
    return fail("locked");
  }
  const outcome = await api.removeUser(key, admin.sub);
  if (!outcome.ok) {
    return fail(outcome.error);
  }
  return json({ ok: true });
}

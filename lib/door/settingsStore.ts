/**
 * Settings DO storage, as plain SQL. The Durable Object is a thin wrapper;
 * tests drive this with any object that matches `Sql`.
 */
import { formatEntry, parseEntry } from "./allowlist";
import type { Role, UserRow, UserStore } from "./users";

export type Sql = {
  exec(query: string, ...binds: unknown[]): { toArray(): Record<string, unknown>[] };
};

export const USERS_SQL = `CREATE TABLE IF NOT EXISTS users (
  entry TEXT PRIMARY KEY,
  role TEXT,
  agents TEXT /*json array*/,
  added_by TEXT,
  added_at INTEGER
)`;

export const AUDIT_SQL = `CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  at INTEGER,
  who TEXT,
  action TEXT,
  detail TEXT
)`;

export const SAMPLES_SQL = `CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY,
  at INTEGER,
  agent TEXT,
  kind TEXT,
  value REAL
)`;

export const PLATFORM_SECRET_SQL = `CREATE TABLE IF NOT EXISTS platform_secret (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const PLATFORM_SECRET_NAMES = new Set(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
const PLATFORM_SECRET_VALUE_MAX = 2048;

const SLUG = /^[a-z][a-z0-9-]{0,62}$/;
const SAMPLE_KIND = /^[a-z][a-z0-9_-]{0,63}$/;

export type PutUserInput = {
  entry: unknown;
  role: unknown;
  agents?: unknown;
};

export type PutOutcome
  = | { ok: true; user: UserRow }
    | { ok: false; error: "bad_entry" | "bad_role" | "bad_agents" };

export type RemoveOutcome
  = | { ok: true }
    | { ok: false; error: "bad_entry" | "not_found" };

export type AuditEvent = {
  id: number;
  at: number;
  who: string;
  action: string;
  detail: string;
};

export type SampleInput = {
  agent: string;
  kind: string;
  value: number;
};

export type SampleRow = {
  id: number;
  at: number;
  agent: string;
  kind: string;
  value: number;
};

/** Filter for `listSamples`. `agent` wins when both agent fields are set. */
export type SampleQuery = {
  agent?: string;
  /** Empty array matches nothing. Omitted with no `agent` returns every agent. */
  agents?: readonly string[];
  /** Inclusive ms epoch. Omitted means no lower bound. */
  since?: number;
  limit?: number;
};

export type SampleOutcome
  = | { ok: true; sample: SampleRow }
    | { ok: false; error: "bad_sample" };

export type UserMutations = {
  putUser(input: PutUserInput, actor: string): Promise<PutOutcome>;
  removeUser(entry: string, actor: string): Promise<RemoveOutcome>;
  audit(limit?: number): Promise<AuditEvent[]>;
};

export type PutPlatformSecretsOutcome
  = | { ok: true }
    | { ok: false; error: "bad_key" | "bad_value" };

export type SettingsStore = UserStore & UserMutations & {
  addSample(input: SampleInput): Promise<SampleOutcome>;
  samples(limit?: number): Promise<SampleRow[]>;
  listSamples(query?: SampleQuery): Promise<SampleRow[]>;
  deleteSamplesForAgent(agent: string): Promise<void>;
  removeSlugFromOperators(slug: string): Promise<void>;
  platformSecrets(): Promise<Record<string, string>>;
  putPlatformSecrets(patch: Record<string, string | null>, actor: string): Promise<PutPlatformSecretsOutcome>;
};

export function hasUserMutations(store: UserStore): store is UserStore & UserMutations {
  const candidate = store as Partial<UserMutations>;
  return typeof candidate.putUser === "function"
    && typeof candidate.removeUser === "function"
    && typeof candidate.audit === "function";
}

/** Adapt a Cloudflare SQL cursor (or a test double) to `Sql`, copying each row. */
export function asSql(sql: Sql): Sql {
  return {
    exec(query, ...binds) {
      const cursor = sql.exec(query, ...binds);
      return {
        toArray() {
          return cursor.toArray().map((row) => ({ ...row }));
        },
      };
    },
  };
}

export function migrate(sql: Sql): void {
  sql.exec(USERS_SQL);
  sql.exec(AUDIT_SQL);
  sql.exec(SAMPLES_SQL);
  sql.exec(PLATFORM_SECRET_SQL);
}

export function openSettings(sql: Sql, now: () => number = Date.now): SettingsStore {
  migrate(sql);
  return {
    list: () => Promise.resolve(readUsers(sql)),
    putUser: (input, actor) => Promise.resolve(writeUser(sql, input, actor, now())),
    removeUser: (entry, actor) => Promise.resolve(removeUserRow(sql, entry, actor, now())),
    audit: (limit) => Promise.resolve(readAudit(sql, limit)),
    addSample: (input) => Promise.resolve(writeSample(sql, input, now())),
    samples: (limit) => Promise.resolve(readSamples(sql, limit)),
    listSamples: (query) => Promise.resolve(querySamples(sql, query ?? {})),
    deleteSamplesForAgent: (agent) => Promise.resolve(deleteSamplesForAgent(sql, agent)),
    removeSlugFromOperators: (slug) => Promise.resolve(removeSlugFromOperators(sql, slug)),
    platformSecrets: () => Promise.resolve(readPlatformSecrets(sql)),
    putPlatformSecrets: (patch, actor) => Promise.resolve(writePlatformSecrets(sql, patch, actor, now())),
  };
}

function platformSecretValueOk(value: string): boolean {
  if (value.length === 0 || value.length > PLATFORM_SECRET_VALUE_MAX) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }
  return true;
}

function readPlatformSecrets(sql: Sql): Record<string, string> {
  const found = rows(sql, "SELECT name, value FROM platform_secret");
  const out: Record<string, string> = {};
  for (const row of found) {
    const name = asText(row.name);
    const value = asText(row.value);
    if (!name || !PLATFORM_SECRET_NAMES.has(name) || !value) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      out[name] = trimmed;
    }
  }
  return out;
}

function writePlatformSecrets(
  sql: Sql,
  patch: Record<string, string | null>,
  actor: string,
  at: number,
): PutPlatformSecretsOutcome {
  for (const [key, raw] of Object.entries(patch)) {
    if (!PLATFORM_SECRET_NAMES.has(key)) {
      return { ok: false, error: "bad_key" };
    }
    if (raw === null || raw === "") {
      sql.exec("DELETE FROM platform_secret WHERE name = ?", key);
      insertAudit(sql, at, actor, "platform_secret", { key, action: "cleared" });
      continue;
    }
    if (typeof raw !== "string") {
      return { ok: false, error: "bad_value" };
    }
    const trimmed = raw.trim();
    if (!platformSecretValueOk(trimmed)) {
      return { ok: false, error: "bad_value" };
    }
    const existing = rows(sql, "SELECT name FROM platform_secret WHERE name = ?", key);
    if (existing.length > 0) {
      sql.exec("UPDATE platform_secret SET value = ? WHERE name = ?", trimmed, key);
    } else {
      sql.exec("INSERT INTO platform_secret (name, value) VALUES (?, ?)", key, trimmed);
    }
    insertAudit(sql, at, actor, "platform_secret", { key, action: "set" });
  }
  return { ok: true };
}

function deleteSamplesForAgent(sql: Sql, agentRaw: string): void {
  const agent = agentRaw.trim().toLowerCase();
  if (!SLUG.test(agent)) {
    return;
  }
  sql.exec("DELETE FROM samples WHERE agent = ?", agent);
}

function removeSlugFromOperators(sql: Sql, slugRaw: string): void {
  const slug = slugRaw.trim().toLowerCase();
  if (!SLUG.test(slug)) {
    return;
  }
  const found = rows(sql, "SELECT entry, role, agents FROM users");
  for (const row of found) {
    if (!isRole(row.role) || row.role !== "operator") {
      continue;
    }
    const agents = parseAgents(row.agents);
    if (!agents.includes(slug)) {
      continue;
    }
    const next = agents.filter((item) => item !== slug);
    sql.exec("UPDATE users SET agents = ? WHERE entry = ?", JSON.stringify(next), row.entry);
  }
}

function rows(sql: Sql, query: string, ...binds: unknown[]): Record<string, unknown>[] {
  return sql.exec(query, ...binds).toArray();
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "operator" || value === "member";
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.min(200, Math.max(1, Math.trunc(limit)));
}

function normalizeAgents(role: Role, agents: unknown): { ok: true; agents: string[] } | { ok: false } {
  if (role !== "operator" || agents == null) {
    return { ok: true, agents: [] };
  }
  if (!Array.isArray(agents) || agents.length > 64) {
    return { ok: false };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of agents) {
    if (typeof raw !== "string") {
      return { ok: false };
    }
    const slug = raw.trim().toLowerCase();
    if (!slug || seen.has(slug)) {
      continue;
    }
    if (!SLUG.test(slug)) {
      return { ok: false };
    }
    seen.add(slug);
    out.push(slug);
  }
  out.sort();
  return { ok: true, agents: out };
}

function parseAgents(raw: unknown): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapUser(row: Record<string, unknown>): UserRow | null {
  if (typeof row.entry !== "string" || !isRole(row.role)) {
    return null;
  }
  const entry = parseEntry(row.entry);
  if (!entry) {
    return null;
  }
  return { entry, role: row.role, agents: parseAgents(row.agents), locked: false };
}

function readUsers(sql: Sql): UserRow[] {
  const found = rows(sql, "SELECT entry, role, agents FROM users ORDER BY added_at ASC, entry ASC");
  const out: UserRow[] = [];
  for (const row of found) {
    const mapped = mapUser(row);
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

function insertAudit(sql: Sql, at: number, who: string, action: string, detail: Record<string, unknown>): void {
  sql.exec(
    "INSERT INTO audit (at, who, action, detail) VALUES (?, ?, ?, ?)",
    at,
    who,
    action,
    JSON.stringify(detail),
  );
}

function writeUser(sql: Sql, input: PutUserInput, actor: string, at: number): PutOutcome {
  if (typeof input.entry !== "string") {
    return { ok: false, error: "bad_entry" };
  }
  const parsed = parseEntry(input.entry);
  if (!parsed) {
    return { ok: false, error: "bad_entry" };
  }
  if (!isRole(input.role)) {
    return { ok: false, error: "bad_role" };
  }
  const agents = normalizeAgents(input.role, input.agents);
  if (!agents.ok) {
    return { ok: false, error: "bad_agents" };
  }
  const key = formatEntry(parsed);
  const agentsJson = JSON.stringify(agents.agents);
  const existing = rows(sql, "SELECT entry FROM users WHERE entry = ?", key);
  if (existing.length > 0) {
    sql.exec("UPDATE users SET role = ?, agents = ? WHERE entry = ?", input.role, agentsJson, key);
    insertAudit(sql, at, actor, "user.update", { entry: key, role: input.role, agents: agents.agents });
  } else {
    sql.exec(
      "INSERT INTO users (entry, role, agents, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
      key,
      input.role,
      agentsJson,
      actor,
      at,
    );
    insertAudit(sql, at, actor, "user.add", { entry: key, role: input.role, agents: agents.agents });
  }
  return { ok: true, user: { entry: parsed, role: input.role, agents: agents.agents, locked: false } };
}

function removeUserRow(sql: Sql, entry: string, actor: string, at: number): RemoveOutcome {
  const parsed = parseEntry(entry);
  if (!parsed) {
    return { ok: false, error: "bad_entry" };
  }
  const key = formatEntry(parsed);
  const existing = rows(sql, "SELECT entry FROM users WHERE entry = ?", key);
  if (existing.length === 0) {
    return { ok: false, error: "not_found" };
  }
  sql.exec("DELETE FROM users WHERE entry = ?", key);
  insertAudit(sql, at, actor, "user.remove", { entry: key });
  return { ok: true };
}

function mapAudit(row: Record<string, unknown>): AuditEvent | null {
  const id = asInt(row.id);
  const at = asInt(row.at);
  const who = asText(row.who);
  const action = asText(row.action);
  const detail = asText(row.detail);
  if (id == null || at == null || who == null || action == null || detail == null) {
    return null;
  }
  return { id, at, who, action, detail };
}

function readAudit(sql: Sql, limit: number | undefined): AuditEvent[] {
  const found = rows(
    sql,
    "SELECT id, at, who, action, detail FROM audit ORDER BY id DESC LIMIT ?",
    clampLimit(limit),
  );
  const out: AuditEvent[] = [];
  for (const row of found) {
    const event = mapAudit(row);
    if (event) {
      out.push(event);
    }
  }
  return out;
}

function writeSample(sql: Sql, input: SampleInput, at: number): SampleOutcome {
  const agent = input.agent.trim().toLowerCase();
  const kind = input.kind.trim().toLowerCase();
  if (!SLUG.test(agent) || !SAMPLE_KIND.test(kind) || typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return { ok: false, error: "bad_sample" };
  }
  sql.exec("INSERT INTO samples (at, agent, kind, value) VALUES (?, ?, ?, ?)", at, agent, kind, input.value);
  const inserted = rows(sql, "SELECT id, at, agent, kind, value FROM samples WHERE rowid = last_insert_rowid()");
  const row = inserted[0];
  const id = row ? asInt(row.id) : null;
  const stamped = row ? asInt(row.at) : null;
  if (!row || id == null || stamped == null) {
    return { ok: false, error: "bad_sample" };
  }
  return { ok: true, sample: { id, at: stamped, agent, kind, value: input.value } };
}

function mapSample(row: Record<string, unknown>): SampleRow | null {
  const id = asInt(row.id);
  const at = asInt(row.at);
  const agent = asText(row.agent);
  const kind = asText(row.kind);
  const value = typeof row.value === "number" ? row.value : null;
  if (id == null || at == null || agent == null || kind == null || value == null) {
    return null;
  }
  return { id, at, agent, kind, value };
}

function mapSamples(found: Record<string, unknown>[]): SampleRow[] {
  const out: SampleRow[] = [];
  for (const row of found) {
    const mapped = mapSample(row);
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

function readSamples(sql: Sql, limit: number | undefined): SampleRow[] {
  return mapSamples(rows(
    sql,
    "SELECT id, at, agent, kind, value FROM samples ORDER BY id DESC LIMIT ?",
    clampLimit(limit),
  ));
}

function sinceBind(since: number | undefined): number | null {
  if (typeof since !== "number" || !Number.isFinite(since)) {
    return null;
  }
  return since;
}

function querySamples(sql: Sql, query: SampleQuery): SampleRow[] {
  const since = sinceBind(query.since);
  const limit = clampLimit(query.limit);
  const sinceSql = since == null ? "" : " AND at >= ?";
  const sinceBinds = since == null ? [] : [since];
  const single = typeof query.agent === "string" ? query.agent.trim().toLowerCase() : "";
  if (single) {
    if (!SLUG.test(single)) {
      return [];
    }
    return mapSamples(rows(
      sql,
      `SELECT id, at, agent, kind, value FROM samples WHERE agent = ?${sinceSql} ORDER BY id DESC LIMIT ?`,
      single,
      ...sinceBinds,
      limit,
    ));
  }
  if (query.agents) {
    const slugs = [...new Set(query.agents.map((agent) => agent.trim().toLowerCase()).filter((agent) => SLUG.test(agent)))];
    if (slugs.length === 0) {
      return [];
    }
    const marks = slugs.map(() => "?").join(", ");
    return mapSamples(rows(
      sql,
      `SELECT id, at, agent, kind, value FROM samples WHERE agent IN (${marks})${sinceSql} ORDER BY id DESC LIMIT ?`,
      ...slugs,
      ...sinceBinds,
      limit,
    ));
  }
  const where = since == null ? "" : " WHERE at >= ?";
  return mapSamples(rows(
    sql,
    `SELECT id, at, agent, kind, value FROM samples${where} ORDER BY id DESC LIMIT ?`,
    ...sinceBinds,
    limit,
  ));
}

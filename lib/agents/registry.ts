/**
 * Settings DO `agents` table. Inventory only — never secrets. Audit rows
 * share the settings `audit` table (`lib/door/settingsStore`).
 */
import { AGENT_SLUG, type AgentRow } from "@/lib/agents/types";
import { AUDIT_SQL, type Sql } from "@/lib/door/settingsStore";

export const AGENTS_SQL = `CREATE TABLE IF NOT EXISTS agents (
  slug TEXT PRIMARY KEY,
  name TEXT,
  created_by TEXT,
  created_at INTEGER,
  tags TEXT /*json array*/,
  enabled INTEGER NOT NULL DEFAULT 1
)`;

const NAME_MAX = 80;
const TAG_MAX = 64;
const TAGS_MAX = 32;

export type AgentCreateBody = {
  slug: unknown;
  name?: unknown;
  tags?: unknown;
};

export type AgentWrite
  = | { ok: true; agent: AgentRow }
    | { ok: false; error: "bad_slug" | "bad_name" | "bad_tags" | "exists" | "name_exists" };

export type AgentDelete
  = | { ok: true }
    | { ok: false; error: "bad_slug" | "not_found" };

export type AgentEnabledSet
  = | { ok: true; agent: AgentRow }
    | { ok: false; error: "bad_slug" | "not_found" | "bad_enabled" };

export type AgentRegistry = {
  list(): Promise<AgentRow[]>;
  get(slug: string): Promise<AgentRow | null>;
  create(input: AgentCreateBody, actor: string): Promise<AgentWrite>;
  remove(slug: string, actor: string): Promise<AgentDelete>;
  setEnabled(slug: string, enabled: boolean, actor: string): Promise<AgentEnabledSet>;
};

function agentsHasEnabled(sql: Sql): boolean {
  const info = rows(sql, "PRAGMA table_info(agents)");
  return info.some((row) => row.name === "enabled");
}

export function migrateAgents(sql: Sql): void {
  sql.exec(AGENTS_SQL);
  if (!agentsHasEnabled(sql)) {
    sql.exec("ALTER TABLE agents ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
  }
  sql.exec(AUDIT_SQL);
}

export function openRegistry(sql: Sql, now: () => number = Date.now): AgentRegistry {
  migrateAgents(sql);
  return {
    list: () => Promise.resolve(readAgents(sql)),
    get: (slug) => Promise.resolve(readAgent(sql, slug)),
    create: (input, actor) => Promise.resolve(createAgent(sql, input, actor, now())),
    remove: (slug, actor) => Promise.resolve(removeAgent(sql, slug, actor, now())),
    setEnabled: (slug, enabled, actor) => Promise.resolve(setAgentEnabled(sql, slug, enabled, actor, now())),
  };
}

function rows(sql: Sql, query: string, ...binds: unknown[]): Record<string, unknown>[] {
  return sql.exec(query, ...binds).toArray();
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

function hasControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function normalizeSlug(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const slug = raw.trim().toLowerCase();
  return AGENT_SLUG.test(slug) ? slug : null;
}

function parseTags(raw: unknown): string[] {
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

function normalizeTags(raw: unknown): { ok: true; tags: string[] } | { ok: false } {
  if (raw == null) {
    return { ok: true, tags: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false };
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false };
    }
    const tag = item.trim();
    if (!tag || seen.has(tag)) {
      continue;
    }
    if (tag.length > TAG_MAX || hasControl(tag)) {
      return { ok: false };
    }
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > TAGS_MAX) {
    return { ok: false };
  }
  tags.sort((a, b) => a.localeCompare(b));
  return { ok: true, tags };
}

function normalizeName(raw: unknown, slug: string): { ok: true; name: string } | { ok: false } {
  if (raw == null) {
    return { ok: true, name: slug };
  }
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const name = raw.trim();
  if (!name) {
    return { ok: true, name: slug };
  }
  if (name.length > NAME_MAX || hasControl(name)) {
    return { ok: false };
  }
  return { ok: true, name };
}

function asEnabled(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  const n = asInt(value);
  return n == null ? true : n !== 0;
}

function mapAgent(row: Record<string, unknown>): AgentRow | null {
  const slug = asText(row.slug);
  const name = asText(row.name);
  const createdAt = asInt(row.created_at);
  if (!slug || !AGENT_SLUG.test(slug) || !name || createdAt == null) {
    return null;
  }
  return {
    slug,
    name,
    createdBy: asText(row.created_by) ?? "",
    createdAt,
    tags: parseTags(row.tags),
    enabled: asEnabled(row.enabled),
  };
}

function readAgents(sql: Sql): AgentRow[] {
  const found = rows(sql, "SELECT slug, name, created_by, created_at, tags, enabled FROM agents ORDER BY created_at ASC, slug ASC");
  const out: AgentRow[] = [];
  for (const row of found) {
    const mapped = mapAgent(row);
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

function readAgent(sql: Sql, slug: string): AgentRow | null {
  const key = normalizeSlug(slug);
  if (!key) {
    return null;
  }
  const found = rows(sql, "SELECT slug, name, created_by, created_at, tags, enabled FROM agents WHERE slug = ?", key);
  const row = found[0];
  return row ? mapAgent(row) : null;
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

function createAgent(sql: Sql, input: AgentCreateBody, actor: string, at: number): AgentWrite {
  const slug = normalizeSlug(input.slug);
  if (!slug) {
    return { ok: false, error: "bad_slug" };
  }
  const name = normalizeName(input.name, slug);
  if (!name.ok) {
    return { ok: false, error: "bad_name" };
  }
  const tags = normalizeTags(input.tags);
  if (!tags.ok) {
    return { ok: false, error: "bad_tags" };
  }
  const existing = rows(sql, "SELECT slug FROM agents WHERE slug = ?", slug);
  if (existing.length > 0) {
    return { ok: false, error: "exists" };
  }
  const resolvedLower = name.name.toLowerCase();
  const takenName = rows(
    sql,
    "SELECT slug FROM agents WHERE LOWER(name) = ? OR slug = ? OR LOWER(name) = ? LIMIT 1",
    resolvedLower,
    resolvedLower,
    slug,
  );
  if (takenName.length > 0) {
    return { ok: false, error: "name_exists" };
  }
  const who = typeof actor === "string" ? actor : "";
  const tagsJson = JSON.stringify(tags.tags);
  sql.exec(
    "INSERT INTO agents (slug, name, created_by, created_at, tags, enabled) VALUES (?, ?, ?, ?, ?, 1)",
    slug,
    name.name,
    who,
    at,
    tagsJson,
  );
  insertAudit(sql, at, who, "agent.add", { slug, name: name.name, tags: tags.tags });
  return {
    ok: true,
    agent: { slug, name: name.name, createdBy: who, createdAt: at, tags: tags.tags, enabled: true },
  };
}

function setAgentEnabled(sql: Sql, slug: string, enabled: boolean, actor: string, at: number): AgentEnabledSet {
  const key = normalizeSlug(slug);
  if (!key) {
    return { ok: false, error: "bad_slug" };
  }
  if (typeof enabled !== "boolean") {
    return { ok: false, error: "bad_enabled" };
  }
  const existing = rows(sql, "SELECT slug FROM agents WHERE slug = ?", key);
  if (existing.length === 0) {
    return { ok: false, error: "not_found" };
  }
  sql.exec("UPDATE agents SET enabled = ? WHERE slug = ?", enabled ? 1 : 0, key);
  const row = readAgent(sql, key);
  if (!row) {
    return { ok: false, error: "not_found" };
  }
  const who = typeof actor === "string" ? actor : "";
  insertAudit(sql, at, who, "agent.enabled", { slug: key, enabled });
  return { ok: true, agent: row };
}

function removeAgent(sql: Sql, slug: string, actor: string, at: number): AgentDelete {
  const key = normalizeSlug(slug);
  if (!key) {
    return { ok: false, error: "bad_slug" };
  }
  const existing = rows(sql, "SELECT slug FROM agents WHERE slug = ?", key);
  if (existing.length === 0) {
    return { ok: false, error: "not_found" };
  }
  sql.exec("DELETE FROM agents WHERE slug = ?", key);
  const who = typeof actor === "string" ? actor : "";
  insertAudit(sql, at, who, "agent.remove", { slug: key });
  return { ok: true };
}

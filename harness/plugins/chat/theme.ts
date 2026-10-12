import type { Clock } from "@/harness/core/clock";
import type { Sql } from "@/harness/core/sql";
import { migrate } from "@/harness/core/sql";
import { nextThemeList, themeCatalogKey, type ServerConfig } from "./config";

export const themeCatalogTTL = 5 * 60 * 1000;

const migration = {
  id: "chat.theme.001",
  up: ["CREATE TABLE IF NOT EXISTS chat_theme_catalog (room_key TEXT PRIMARY KEY, ids TEXT NOT NULL, at INTEGER NOT NULL)"],
};

function ensure(sql: Sql): void {
  migrate(sql, [migration]);
}

export function rememberThemeCatalog(sql: Sql, clock: Clock, cfg: ServerConfig, ids: ReadonlySet<string>): void {
  ensure(sql);
  const list = [...ids].filter((id) => id.length > 0).sort();
  sql.exec(
    "INSERT INTO chat_theme_catalog (room_key, ids, at) VALUES (?, ?, ?) ON CONFLICT(room_key) DO UPDATE SET ids = excluded.ids, at = excluded.at",
    themeCatalogKey(cfg),
    JSON.stringify(list),
    clock.now(),
  );
}

export function forgetThemeCatalog(sql: Sql, cfg: ServerConfig): void {
  ensure(sql);
  sql.exec("DELETE FROM chat_theme_catalog WHERE room_key = ?", themeCatalogKey(cfg));
}

export function cachedThemeIDs(sql: Sql, clock: Clock, cfg: ServerConfig): Set<string> | undefined {
  ensure(sql);
  const row = sql.one<{ ids: string; at: number }>("SELECT ids, at FROM chat_theme_catalog WHERE room_key = ?", themeCatalogKey(cfg));
  if (!row || typeof row.ids !== "string" || typeof row.at !== "number") return undefined;
  const at = row.at;
  if (clock.now() - at > themeCatalogTTL) return undefined;
  const ids = parseIdList(row.ids);
  if (ids.size === 0) return undefined;
  return ids;
}

export function parseThemeIDs(raw: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("bad theme catalog");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.themes)) throw new Error("bad theme catalog");
  const ids = new Set<string>();
  for (const card of parsed.themes) {
    if (!isRecord(card) || typeof card.id !== "string") continue;
    const id = card.id.trim().toLowerCase();
    if (id) ids.add(id);
  }
  if (ids.size === 0) throw new Error(`theme catalog is empty. ${nextThemeList}`);
  return ids;
}

function parseIdList(raw: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const ids = new Set<string>();
  for (const id of parsed) {
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

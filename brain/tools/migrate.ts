/**
 * Schema for per-session tool enablement and OAuth tokens at rest.
 * Ids are package-scoped (`tools.001`…) so they share `brain_migration`
 * with the rest of the brain.
 */
import { migrate, type Migration, type Sql } from "@/brain/core/sql";

export const TOOL_MIGRATIONS: readonly Migration[] = [
  {
    id: "tools.001",
    up: [
      `CREATE TABLE IF NOT EXISTS mcp_enable (
        session_id TEXT NOT NULL,
        prefix TEXT NOT NULL,
        hold TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'agent',
        last_used INTEGER NOT NULL,
        PRIMARY KEY (session_id, prefix)
      )`,
    ],
  },
  {
    // Legacy rows used hold = 'long' for the 27h window. 'short' is that window.
    id: "tools.002",
    up: ["UPDATE mcp_enable SET hold = 'short' WHERE hold = 'long'"],
  },
  {
    id: "tools.003",
    up: [
      `CREATE TABLE IF NOT EXISTS oauth_token (
        provider TEXT PRIMARY KEY,
        blob BLOB NOT NULL,
        at INTEGER NOT NULL
      )`,
    ],
  },
];

/** Apply tool migrations. Safe to call from every store constructor. */
export function migrateTools(sql: Sql): string[] {
  return migrate(sql, [...TOOL_MIGRATIONS]);
}

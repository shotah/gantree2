import { type Migration, type Sql } from "@/harness/core/sql";

/**
 * Same table and column names as harness `gantry.db`. `consolidate_attempts`
 * sits last, where the Go `ALTER TABLE` appended it, so a copied file lines up.
 * FTS5 external content plus the three sync triggers live in `memory.002`.
 */
export const memoryMigrations: Migration[] = [
  {
    id: "memory.001",
    up: [
      `CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        superseded_by INTEGER,
        consolidated INTEGER NOT NULL DEFAULT 0,
        consolidate_attempts INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memory_active ON memory(kind, updated_at DESC)`,
    ],
  },
  {
    id: "memory.002",
    up: [
      `CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        subject, content,
        content='memory',
        content_rowid='id'
      )`,
      `CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
        INSERT INTO memory_fts(rowid, subject, content)
        VALUES (new.id, new.subject, new.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, subject, content)
        VALUES('delete', old.id, old.subject, old.content);
      END`,
      `CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, subject, content)
        VALUES('delete', old.id, old.subject, old.content);
        INSERT INTO memory_fts(rowid, subject, content)
        VALUES (new.id, new.subject, new.content);
      END`,
    ],
  },
];

/**
 * A copied database from before the attempts column has the table already, so
 * `memory.001`'s `CREATE IF NOT EXISTS` does not add it. Match the Go open,
 * which alters and ignores "duplicate column".
 */
export function ensureConsolidateAttempts(sql: Sql): void {
  const cols = sql.exec("PRAGMA table_info(memory)");
  if (cols.some((c) => c.name === "consolidate_attempts")) {
    return;
  }
  sql.exec("ALTER TABLE memory ADD COLUMN consolidate_attempts INTEGER NOT NULL DEFAULT 0");
}

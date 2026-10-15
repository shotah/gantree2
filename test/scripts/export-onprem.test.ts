import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { memoryMigrations } from "@/harness/memory/schema";
import { AIM_MIGRATIONS } from "@/harness/aims/schema";
import { migrate, nodeSql, type NodeDatabase } from "@/harness/core/sql";
import { ONPREM_BUNDLE_VERSION } from "@/lib/migrate/onprem";
import { exportOnPremDatabase, parseExportArgs } from "@/scripts/export-onprem";

function openExportDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const sql = nodeSql(db as unknown as NodeDatabase);
  migrate(sql, memoryMigrations);
  migrate(sql, AIM_MIGRATIONS);
  sql.exec(
    `CREATE TABLE oauth_token (
      provider TEXT PRIMARY KEY,
      blob TEXT NOT NULL,
      at INTEGER NOT NULL
    )`,
  );
  sql.exec(
    `INSERT INTO memory (id, kind, subject, content, source, confidence, created_at, updated_at, consolidated, consolidate_attempts)
     VALUES (1, 'fact', 'city', 'Portland', 'human', 1.0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 0)`,
  );
  sql.exec(
    `INSERT INTO memory (id, kind, subject, content, source, confidence, created_at, updated_at, consolidated, consolidate_attempts)
     VALUES (2, 'aim/health', 'walk', 'Daily walk', 'agent', 1.0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 0, 0)`,
  );
  sql.exec(
    `INSERT INTO aim_event (id, day, what, ref, metric, value, unit, source, created_at)
     VALUES (1, '2026-01-02', 'Walked', '', '', NULL, '', 'agent', '2026-01-02T12:00:00Z')`,
  );
  sql.exec(
    "INSERT INTO oauth_token (provider, blob, at) VALUES ('google', 'secret-blob', 1)",
  );
  return db;
}

describe("export-onprem", () => {
  it("parses args", () => {
    expect(parseExportArgs(["--db", "./x.db", "--out", "out.json"])).toEqual({
      help: false,
      db: "./x.db",
      out: "out.json",
    });
  });

  it("exports memory and aims but not oauth_token", () => {
    const db = openExportDb();
    const bundle = exportOnPremDatabase(db);
    expect(bundle.version).toBe(ONPREM_BUNDLE_VERSION);
    expect(bundle.memory.rows).toHaveLength(2);
    expect(bundle.aim_event.rows).toHaveLength(1);
    expect(bundle.aim_score.rows).toEqual([]);
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("oauth_token");
    expect(json).not.toContain("secret-blob");
    db.close();
  });
});

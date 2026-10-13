/**
 * One SQL surface for the harness. Production is the Agent Durable Object's
 * `ctx.storage.sql` (SQLite). Tests are `node:sqlite` in memory. Both speak
 * the same dialect, so a package ports its Go `database/sql` code once and
 * runs it against either.
 *
 * Only positional `?` bindings. No transactions API on purpose: the DO runs
 * each `exec` atomically and a Worker invocation is one implicit transaction
 * (`ctx.storage.transactionSync` exists if a package truly needs it — wrap it
 * in this interface rather than reaching past it).
 */

export type SqlValue = string | number | null | Uint8Array | ArrayBuffer;
export type SqlRow = Record<string, SqlValue>;

export type Sql = {
  /** Run one statement; return every row. DDL and writes return `[]`. */
  exec<T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]): T[];
  /** First row or `null`. */
  one<T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]): T | null;
  /** Rows written by the last `exec` (INSERT/UPDATE/DELETE). On Durable Object SQLite this includes index rows, so compare against zero, never against 1. */
  changes(): number;
};

/** Ordered, idempotent schema steps. `id` is unique per package: `memory.001`. */
export type Migration = { id: string; up: string[] };

/**
 * Apply migrations not yet in `brain_migration`. Each package calls this with
 * its own list on open; the table is shared, ids are namespaced.
 */
export function migrate(sql: Sql, migrations: Migration[]): string[] {
  sql.exec("CREATE TABLE IF NOT EXISTS brain_migration (id TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  const done = new Set(sql.exec<{ id: string }>("SELECT id FROM brain_migration").map((r) => r.id));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) {
      continue;
    }
    for (const statement of m.up) {
      sql.exec(statement);
    }
    sql.exec("INSERT INTO brain_migration (id, at) VALUES (?, ?)", m.id, Date.now());
    applied.push(m.id);
  }
  return applied;
}

/** Durable Object `ctx.storage.sql`. */
export function doSql(storage: SqlStorage): Sql {
  let written = 0;
  return {
    exec<T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]): T[] {
      const cursor = storage.exec(query, ...params);
      const rows = cursor.toArray() as unknown as T[];
      written = cursor.rowsWritten;
      return rows;
    },
    one<T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]): T | null {
      const cursor = storage.exec(query, ...params);
      const rows = cursor.toArray() as unknown as T[];
      written = cursor.rowsWritten;
      return rows[0] ?? null;
    },
    changes: () => written,
  };
}

/**
 * `node:sqlite` `DatabaseSync` (Node ≥ 22.13). Tests only — the import is
 * lazy so the Worker bundle never sees `node:sqlite`.
 */
type NodeStatement = {
  all(...params: SqlValue[]): unknown[];
  run(...params: SqlValue[]): { changes: number | bigint };
};

/** Structural stand-in for `DatabaseSync` so this file never imports `node:sqlite`. */
export type NodeDatabase = {
  prepare(query: string): NodeStatement;
  exec(query: string): void;
};

export function nodeSql(db: NodeDatabase): Sql {
  let written = 0;
  const run = <T extends SqlRow>(query: string, params: SqlValue[]): T[] => {
    const stmt = db.prepare(query);
    const head = query.trimStart().slice(0, 6).toUpperCase();
    const reads = head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("PRAGMA") || /\bRETURNING\b/i.test(query);
    if (reads) {
      written = 0;
      return stmt.all(...params) as T[];
    }
    written = Number(stmt.run(...params).changes);
    return [];
  };
  return {
    exec: <T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]) => run<T>(query, params),
    one: <T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]) => run<T>(query, params)[0] ?? null,
    changes: () => written,
  };
}

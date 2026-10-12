import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { doSql, migrate, nodeSql, type NodeDatabase, type Sql } from "@/harness/core/sql";

function fresh(): Sql {
  // `DatabaseSync` types its bindings narrower than `SqlValue` (no ArrayBuffer); the runtime accepts them.
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

describe("nodeSql", () => {
  it("runs DDL, writes, and reads with positional bindings", () => {
    const sql = fresh();
    sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    sql.exec("INSERT INTO t (name) VALUES (?)", "ada");
    expect(sql.changes()).toBe(1);
    sql.exec("INSERT INTO t (name) VALUES (?)", "kit");
    expect(sql.exec<{ name: string }>("SELECT name FROM t ORDER BY id").map((r) => r.name)).toEqual(["ada", "kit"]);
    expect(sql.one<{ n: number }>("SELECT COUNT(*) AS n FROM t")?.n).toBe(2);
    expect(sql.one("SELECT * FROM t WHERE name = ?", "nobody")).toBeNull();
  });

  it("reports changes for UPDATE and DELETE, zero for SELECT", () => {
    const sql = fresh();
    sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    sql.exec("INSERT INTO t (v) VALUES (1), (2), (3)");
    expect(sql.changes()).toBe(3);
    sql.exec("UPDATE t SET v = v + 1 WHERE v > ?", 1);
    expect(sql.changes()).toBe(2);
    sql.exec("SELECT * FROM t");
    expect(sql.changes()).toBe(0);
    sql.exec("DELETE FROM t");
    expect(sql.changes()).toBe(3);
  });

  it("returns rows from RETURNING", () => {
    const sql = fresh();
    sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const rows = sql.exec<{ id: number }>("INSERT INTO t (v) VALUES (?) RETURNING id", "x");
    expect(rows).toEqual([{ id: 1 }]);
  });
});

describe("migrate", () => {
  it("applies each id once, in order, and records it", () => {
    const sql = fresh();
    const steps = [
      { id: "demo.001", up: ["CREATE TABLE a (x INTEGER)"] },
      { id: "demo.002", up: ["ALTER TABLE a ADD COLUMN y INTEGER", "CREATE INDEX a_y ON a (y)"] },
    ];
    expect(migrate(sql, steps)).toEqual(["demo.001", "demo.002"]);
    expect(migrate(sql, steps)).toEqual([]);
    expect(migrate(sql, [...steps, { id: "demo.003", up: ["CREATE TABLE b (z INTEGER)"] }])).toEqual(["demo.003"]);
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration ORDER BY id").map((r) => r.id))
      .toEqual(["demo.001", "demo.002", "demo.003"]);
  });
});

describe("doSql", () => {
  it("adapts a SqlStorage-shaped cursor", () => {
    const calls: { query: string; params: unknown[] }[] = [];
    const storage = {
      exec: (query: string, ...params: unknown[]) => {
        calls.push({ query, params });
        return {
          toArray: () => (query.startsWith("SELECT") ? [{ id: 1 }] : []),
          rowsWritten: query.startsWith("INSERT") ? 1 : 0,
        };
      },
    } as unknown as SqlStorage;
    const sql = doSql(storage);
    sql.exec("INSERT INTO t (v) VALUES (?)", 1);
    expect(sql.changes()).toBe(1);
    expect(sql.one<{ id: number }>("SELECT id FROM t")).toEqual({ id: 1 });
    expect(sql.changes()).toBe(0);
    expect(calls[0]).toEqual({ query: "INSERT INTO t (v) VALUES (?)", params: [1] });
  });
});

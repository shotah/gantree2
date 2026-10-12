import { describe, expect, it } from "vitest";
import { createBrain } from "@/harness/agent";
import { migrate, type Sql } from "@/harness/core/sql";
import { migrations as cronMigrations } from "@/harness/cron/store";
import { hereMigrations } from "@/harness/here";
import { adoptLegacySession, sessionMigrations } from "@/harness/session";
import { migrateTools } from "@/harness/tools/migrate";
import { watchMigrations } from "@/harness/watch";
import { collect, freshSql, scriptResult, Scripted, testDeps } from "./fixture";

const USER = { kind: "inbound" as const, user_id: "u1", id: "m1", text: "Hello" };

function sessionIds(sql: Sql): string[] {
  return sql.exec<{ id: string }>("SELECT id FROM session ORDER BY id").map((row) => row.id);
}

function openBrain(slug: string): Sql {
  const sql = freshSql();
  createBrain({ ...testDeps({ provider: new Scripted([]), sql }), slug });
  return sql;
}

function seedLegacy(sql: Sql): void {
  sql.exec("PRAGMA foreign_keys = ON");
  migrate(sql, sessionMigrations);
  migrate(sql, cronMigrations);
  migrate(sql, watchMigrations);
  migrate(sql, hereMigrations);
  migrateTools(sql);
  sql.exec(
    "INSERT INTO session (id, summary, updated_at, waiting_for_reply) VALUES ('gantry', 'kept', '2026-01-01T00:00:00.000Z', 0)",
  );
  sql.exec(
    "INSERT INTO session_message (session_id, role, content, created_at) VALUES ('gantry', 'user', 'remember this', '2026-01-01T00:00:00.000Z')",
  );
  sql.exec(
    `INSERT INTO cron_job (prompt, kind, expr, timezone, next_run_at, session_id, user_id, created_at, updated_at)
     VALUES ('legacy ping', 'once', 'x', 'UTC', '2026-08-01T00:00:00.000Z', 'gantry', '', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  );
  sql.exec(
    "INSERT INTO session_pref (session_id, examples_enabled, planner_at, updated_at) VALUES ('gantry', 1, '07:10', '2026-08-01T00:00:00.000Z')",
  );
  sql.exec(
    "INSERT INTO watch (tool, args, interval_seconds, next_poll_at, session_id, created_at, updated_at) VALUES ('feeds__items_list', '{}', 60, 0, 'gantry', 1, 1)",
  );
  sql.exec("INSERT INTO here_pin (session_id, lat, lon, at) VALUES ('gantry', 47.6, -122.3, 10)");
  sql.exec(
    "INSERT INTO mcp_enable (session_id, prefix, hold, last_used) VALUES ('gantry', 'feeds', 'short', 1)",
  );
}

function idsWhere(sql: Sql, table: string, column = "session_id"): string[] {
  return sql.exec<{ id: string }>(`SELECT ${column} AS id FROM ${table} ORDER BY id`).map((row) => row.id);
}

describe("room session id", () => {
  it("gives two slugs two session ids, and an empty slug is agent", () => {
    expect(sessionIds(openBrain("alpha"))).toEqual(["alpha"]);
    expect(sessionIds(openBrain("beta"))).toEqual(["beta"]);
    expect(sessionIds(openBrain("  "))).toEqual(["agent"]);
    expect(sessionIds(openBrain("alpha"))).not.toEqual(sessionIds(openBrain("beta")));
  });

  it("returns gantry history under the slug and does not store new rows as gantry", async () => {
    const sql = freshSql();
    seedLegacy(sql);
    const provider = new Scripted([scriptResult({ content: "Noted", toolCalls: [] })]);
    const harness = createBrain({ ...testDeps({ provider, sql }), slug: "kit" });

    expect(sessionIds(sql)).toEqual(["kit"]);
    expect(sql.one<{ summary: string }>("SELECT summary FROM session WHERE id = ?", "kit")?.summary).toBe("kept");
    expect(sql.exec<{ content: string }>(
      "SELECT content FROM session_message WHERE session_id = ? ORDER BY id",
      "kit",
    ).map((row) => row.content)).toEqual(["remember this"]);
    expect(sql.exec("SELECT session_id FROM session_message WHERE session_id = 'gantry'")).toEqual([]);
    expect(sql.exec<{ session_id: string }>(
      "SELECT session_id FROM watch",
    ).map((row) => row.session_id)).toEqual(["kit"]);
    expect(sql.one<{ session_id: string }>(
      "SELECT session_id FROM cron_job WHERE prompt = ?",
      "legacy ping",
    )?.session_id).toBe("kit");
    const prefs = sql.exec<{ session_id: string }>("SELECT session_id FROM session_pref");
    expect(prefs.length).toBeGreaterThan(0);
    expect(prefs.every((row) => row.session_id === "kit")).toBe(true);
    expect(sql.one<{ lat: number; session_id: string }>(
      "SELECT lat, session_id FROM here_pin",
    )).toEqual({ lat: 47.6, session_id: "kit" });
    expect(sql.one<{ prefix: string; session_id: string }>(
      "SELECT prefix, session_id FROM mcp_enable",
    )).toEqual({ prefix: "feeds", session_id: "kit" });

    const { emit, frames } = collect();
    await harness.handleInbound(USER, emit);
    const stored = sql.exec<{ session_id: string; content: string }>(
      "SELECT session_id, content FROM session_message ORDER BY id",
    );
    expect(stored.map((row) => row.content)).toEqual(["remember this", "Hello", "Noted"]);
    expect(stored.every((row) => row.session_id === "kit")).toBe(true);
    expect(sql.exec("SELECT id FROM session WHERE id = 'gantry'")).toEqual([]);
    expect(frames.find((frame) => frame.kind === "perf")).toMatchObject({ turn: "kit", session_id: "kit" });

    const before = sql.exec("SELECT session_id, role, content FROM session_message ORDER BY id");
    createBrain({ ...testDeps({ provider: new Scripted([]), sql }), slug: "kit" });
    expect(sql.exec("SELECT session_id, role, content FROM session_message ORDER BY id")).toEqual(before);
    expect(sql.exec("SELECT id FROM session WHERE id = 'gantry'")).toEqual([]);
  });

  it("renames leftover gantry rows and skips tables that do not exist yet", () => {
    expect(() => adoptLegacySession(freshSql(), "kit")).not.toThrow();

    const sql = freshSql();
    seedLegacy(sql);
    adoptLegacySession(sql, "kit");
    expect(sessionIds(sql)).toEqual(["kit"]);
    expect(sql.one<{ content: string }>(
      "SELECT content FROM session_message WHERE session_id = ?",
      "kit",
    )?.content).toBe("remember this");
    expect(idsWhere(sql, "watch")).toEqual(["kit"]);
    expect(idsWhere(sql, "cron_job")).toEqual(["kit"]);
    expect(idsWhere(sql, "session_pref")).toEqual(["kit"]);
    expect(idsWhere(sql, "here_pin")).toEqual(["kit"]);
    expect(sql.one<{ lat: number }>("SELECT lat FROM here_pin WHERE session_id = ?", "kit")?.lat).toBe(47.6);
    expect(idsWhere(sql, "mcp_enable")).toEqual(["kit"]);
    expect(sql.exec("SELECT id FROM session WHERE id = 'gantry'")).toEqual([]);
    expect(sql.exec("SELECT session_id FROM session_message WHERE session_id = 'gantry'")).toEqual([]);
  });
});

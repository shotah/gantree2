/**
 * Rename leftover `gantry` rows onto the room session id. Tables that are
 * not created yet are skipped; store constructors migrate them on open.
 */
import type { Sql, SqlValue } from "@/brain/core/sql";
import { roomSession } from "./types";

const legacySession = "gantry";

export function adoptLegacySession(sql: Sql, sessionId: string): void {
  const id = roomSession(sessionId);
  if (id === legacySession) return;
  adoptSessionRows(sql, id);
  adoptSessionColumn(sql, "watch", id);
  adoptSessionColumn(sql, "cron_job", id);
  adoptPref(sql, id);
  adoptPin(sql, legacySession, id);
  adoptEnable(sql, legacySession, id);
}

function tableExists(sql: Sql, name: string): boolean {
  const row = sql.one<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return row !== null;
}

type SessionRow = {
  summary: SqlValue;
  updated_at: SqlValue;
  last_speaker: SqlValue;
  waiting_for_reply: SqlValue;
  wait_nudges: SqlValue;
  wait_set_at: SqlValue;
};

function adoptSessionRows(sql: Sql, id: string): void {
  const hasSession = tableExists(sql, "session");
  const hasMessages = tableExists(sql, "session_message");
  if (!hasSession && !hasMessages) return;
  if (hasSession) {
    const legacy = sql.one<SessionRow>(
      `SELECT summary, updated_at, last_speaker, waiting_for_reply, wait_nudges, wait_set_at
       FROM session WHERE id = ?`,
      legacySession,
    );
    if (legacy) {
      sql.exec(
        `INSERT INTO session (id, summary, updated_at, last_speaker, waiting_for_reply, wait_nudges, wait_set_at)
         SELECT ?, summary, updated_at, last_speaker, waiting_for_reply, wait_nudges, wait_set_at
         FROM session WHERE id = ?
         ON CONFLICT(id) DO NOTHING`,
        id,
        legacySession,
      );
      const own = sql.one<{ summary: SqlValue; waiting_for_reply: SqlValue }>(
        "SELECT summary, waiting_for_reply FROM session WHERE id = ?",
        id,
      );
      if (own && text(own.summary).trim() === "" && text(legacy.summary).trim() !== "") {
        sql.exec("UPDATE session SET summary = ? WHERE id = ?", text(legacy.summary), id);
      }
      if (own && num(own.waiting_for_reply) === 0 && num(legacy.waiting_for_reply) !== 0) {
        sql.exec(
          `UPDATE session SET last_speaker = ?, waiting_for_reply = ?, wait_nudges = ?, wait_set_at = ? WHERE id = ?`,
          text(legacy.last_speaker),
          num(legacy.waiting_for_reply),
          num(legacy.wait_nudges),
          text(legacy.wait_set_at),
          id,
        );
      }
    }
    const pending = hasMessages
      ? sql.one<{ n: SqlValue }>("SELECT COUNT(*) AS n FROM session_message WHERE session_id = ?", legacySession)
      : null;
    const dest = sql.one("SELECT id FROM session WHERE id = ?", id);
    if (num(pending?.n) > 0 && dest === null) {
      sql.exec(
        "INSERT INTO session (id, summary, updated_at) VALUES (?, '', ?) ON CONFLICT(id) DO NOTHING",
        id,
        "1970-01-01T00:00:00.000Z",
      );
    }
  }
  if (hasMessages) {
    sql.exec("UPDATE session_message SET session_id = ? WHERE session_id = ?", id, legacySession);
  }
  if (hasSession) sql.exec("DELETE FROM session WHERE id = ?", legacySession);
}

function adoptSessionColumn(sql: Sql, table: "watch" | "cron_job", id: string): void {
  if (!tableExists(sql, table)) return;
  sql.exec(`UPDATE ${table} SET session_id = ? WHERE session_id = ?`, id, legacySession);
}

function adoptPref(sql: Sql, id: string): void {
  if (!tableExists(sql, "session_pref")) return;
  const legacy = sql.one("SELECT session_id FROM session_pref WHERE session_id = ?", legacySession);
  if (!legacy) return;
  const dest = sql.one("SELECT session_id FROM session_pref WHERE session_id = ?", id);
  if (!dest) {
    sql.exec("UPDATE session_pref SET session_id = ? WHERE session_id = ?", id, legacySession);
    return;
  }
  const latest = sql.one<{ session_id: string }>(
    "SELECT session_id FROM session_pref WHERE session_id IN (?, ?) ORDER BY updated_at DESC LIMIT 1",
    id,
    legacySession,
  );
  if (latest?.session_id === legacySession) {
    sql.exec("DELETE FROM session_pref WHERE session_id = ?", id);
    sql.exec("UPDATE session_pref SET session_id = ? WHERE session_id = ?", id, legacySession);
    return;
  }
  sql.exec("DELETE FROM session_pref WHERE session_id = ?", legacySession);
}

function adoptPin(sql: Sql, from: string, id: string): void {
  if (from === id || !tableExists(sql, "here_pin")) return;
  const legacy = sql.one<{ at: SqlValue }>("SELECT at FROM here_pin WHERE session_id = ?", from);
  if (!legacy) return;
  const dest = sql.one<{ at: SqlValue }>("SELECT at FROM here_pin WHERE session_id = ?", id);
  if (!dest) {
    sql.exec("UPDATE here_pin SET session_id = ? WHERE session_id = ?", id, from);
    return;
  }
  if (num(legacy.at) > num(dest.at)) {
    sql.exec("DELETE FROM here_pin WHERE session_id = ?", id);
    sql.exec("UPDATE here_pin SET session_id = ? WHERE session_id = ?", id, from);
    return;
  }
  sql.exec("DELETE FROM here_pin WHERE session_id = ?", from);
}

function adoptEnable(sql: Sql, from: string, id: string): void {
  if (from === id || !tableExists(sql, "mcp_enable")) return;
  sql.exec(
    `DELETE FROM mcp_enable
     WHERE session_id = ?
       AND prefix IN (SELECT prefix FROM mcp_enable WHERE session_id = ?)`,
    from,
    id,
  );
  sql.exec("UPDATE mcp_enable SET session_id = ? WHERE session_id = ?", id, from);
}

function text(value: SqlValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function num(value: SqlValue | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

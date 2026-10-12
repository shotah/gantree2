/**
 * Per-session tool schemas. Prefixes stay off until `mcp_enable` (or an
 * operator force-prefix). Idle clocks drop them: brief is 6h, short is 27h.
 * Unprefixed builtins never idle-drop.
 *
 * `last_used` is epoch milliseconds. The Go store wrote RFC3339; the windows
 * are the same.
 */
import { type Clock } from "@/brain/core/clock";
import { type Sql, type SqlValue } from "@/brain/core/sql";
import { errorResult, textResult, type JsonSchema, type ToolDef, type ToolResult } from "@/brain/core/tools";
import { agentSession, roomSession } from "@/brain/session/types";
import { errorMessage, toolErrorText } from "./errors";
import { migrateTools } from "./migrate";

export const HOLD_BRIEF = "brief";
export const HOLD_SHORT = "short";
export const BRIEF_IDLE_MS = 6 * 60 * 60 * 1000;
export const SHORT_IDLE_MS = 27 * 60 * 60 * 1000;
export const MAX_ENABLE_LIST = 8;
export const ENABLE_TOOL_NAME = "mcp_enable";
export const SOURCE_AGENT = "agent";
export const SOURCE_HUMAN = "human";

const LEGACY_HOLD = "long";

export type EnableRow = {
  sessionId: string;
  prefix: string;
  hold: string;
  source: string;
  /** Epoch ms. */
  lastUsed: number;
};

export type Force = { prefixes: readonly string[] };

export type EnableOutcome = { landed: string[]; failed: string[] };

type EnableSqlRow = {
  session_id: string;
  prefix: string;
  hold: string;
  source: string;
  last_used: SqlValue;
};

/** `MCP_ENABLE_FORCE`: comma-separated prefixes, blanks dropped. */
export function parseForceCsv(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const prefix = part.trim();
    if (prefix) {
      out.push(prefix);
    }
  }
  return out;
}

/**
 * Segment-aware cover. `google` matches `google__*`.
 * `google__calendar` matches `google__calendar_*`.
 * `go` does not match `google__*`.
 */
export function matches(name: string, key: string): boolean {
  const tool = name.trim();
  const prefix = key.trim();
  if (tool === "" || prefix === "") {
    return false;
  }
  if (tool === prefix) {
    return true;
  }
  if (!tool.startsWith(prefix)) {
    return false;
  }
  const rest = tool.slice(prefix.length);
  if (prefix.includes("__")) {
    return rest.startsWith("_");
  }
  return rest.startsWith("__");
}

/** Builtins (no `server__` prefix) never idle-drop. */
export function alwaysOn(name: string): boolean {
  return !name.includes("__");
}

/**
 * Enable keys for a catalog: each server prefix, plus `server__family`
 * when that server has two or more distinct families (the first `_` segment
 * of the tool suffix).
 */
export function enableIndex(defs: readonly { name: string }[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const def of defs) {
    const cut = def.name.indexOf("__");
    if (cut <= 0) {
      continue;
    }
    const server = def.name.slice(0, cut);
    const rest = def.name.slice(cut + 2);
    if (!server || !rest) {
      continue;
    }
    const familyCut = rest.indexOf("_");
    const family = familyCut < 0 ? rest : rest.slice(0, familyCut);
    if (!family) {
      continue;
    }
    let families = by.get(server);
    if (!families) {
      families = new Set();
      by.set(server, families);
    }
    families.add(family);
  }
  const out: string[] = [];
  for (const [server, families] of by) {
    out.push(server);
    if (families.size < 2) {
      continue;
    }
    for (const family of families) {
      out.push(`${server}__${family}`);
    }
  }
  out.sort(compare);
  return out;
}

/** True when `key` is a bare server that has family keys in `index`. */
export function hasSubprefixes(key: string, index: readonly string[]): boolean {
  if (key.includes("__")) {
    return false;
  }
  const want = `${key}__`;
  return index.some((entry) => entry.startsWith(want));
}

/** Longest enabled prefix that matches `name`. */
export function longestKey(name: string, keys: readonly string[]): string | null {
  let best = "";
  for (const key of keys) {
    if (matches(name, key) && key.length >= best.length) {
      best = key;
    }
  }
  return best || null;
}

export function allowed(name: string, enabled: readonly string[], force: Force): boolean {
  if (alwaysOn(name) || name === ENABLE_TOOL_NAME) {
    return true;
  }
  if (forceCoversName(name, force)) {
    return true;
  }
  return longestKey(name, enabled) !== null;
}

/** Model-facing error when a real tool is published but off for this session. */
export function enableHint(name: string, index: readonly string[]): string {
  const found = longestKey(name, index);
  let key = found ?? "";
  if (!key) {
    const cut = name.indexOf("__");
    key = cut >= 0 ? name.slice(0, cut) : name;
  }
  return `not enabled — call mcp_enable with prefixes=[${key}] then retry`;
}

/** Filter a catalog to builtins, `mcp_enable`, force prefixes, and enabled rows. Order is kept. */
export function publishTools(defs: readonly ToolDef[], rows: readonly EnableRow[], force: Force): ToolDef[] {
  const keys = rows.map((row) => row.prefix);
  return defs.filter((def) => allowed(def.name, keys, force));
}

/**
 * Byte-stable prompt line: sorted keys, no ages. The set only changes on
 * enable, drop, or force, so providers can cache it.
 */
export function formatIndex(rows: readonly EnableRow[], index: readonly string[], force: Force): string {
  return renderIndex(indexParts(rows, index, force, null));
}

/** `/tools` — same order, with idle ages. */
export function formatIndexStatus(rows: readonly EnableRow[], index: readonly string[], force: Force, now: number): string {
  return renderIndex(indexParts(rows, index, force, now));
}

export function normalizeHold(hold: string): string {
  return hold.trim().toLowerCase() === HOLD_BRIEF ? HOLD_BRIEF : HOLD_SHORT;
}

/** `/brief`, `/short`, `/off` plus a prefix. Strips a trailing `@bot` on the command. */
export function parseEnableHoldCommand(text: string): { cmd: "/brief" | "/short" | "/off"; prefix: string } | null {
  const fields = text.trim().split(/\s+/);
  if (fields.length < 2) {
    return null;
  }
  const first = fields[0] ?? "";
  const at = first.indexOf("@");
  const raw = (at >= 0 ? first.slice(0, at) : first).toLowerCase();
  if (raw !== "/short" && raw !== "/brief" && raw !== "/off") {
    return null;
  }
  const prefix = fields[1];
  if (!prefix) {
    return null;
  }
  return { cmd: raw, prefix };
}

/** Reply for `/brief`, `/short`, and `/off`. `store` null means dynamic tools are off. */
export function enableHoldReply(
  store: EnableStore | null,
  sessionId: string,
  cmd: string,
  prefix: string,
  index: readonly string[],
): string {
  if (!store) {
    return "dynamic tools are off (mcp.toml dynamic_tools = false) — full catalog is published";
  }
  const key = prefix.trim();
  if (cmd === "/off") {
    store.off(sessionId, key);
    return `off ${key}`;
  }
  if (cmd === "/brief" || cmd === "/short") {
    const hold = cmd === "/brief" ? HOLD_BRIEF : HOLD_SHORT;
    const { landed, failed } = store.enable(sessionId, [key], hold, SOURCE_HUMAN, index);
    const parts: string[] = [];
    if (landed.length > 0) {
      parts.push(`${cmd.slice(1)} ${landed.join(", ")}`);
    }
    if (failed.length > 0) {
      parts.push(failed.join("; "));
    }
    if (parts.length === 0) {
      return "nothing changed";
    }
    return parts.join(" — ");
  }
  return "usage: /brief <prefix> | /short <prefix> | /off <prefix>";
}

export function enableToolDef(): ToolDef {
  const parameters: JsonSchema = {
    type: "object",
    properties: {
      prefixes: {
        type: "array",
        items: { type: "string" },
        description: "a key from [mcp prefixes], e.g. google__calendar when listed, otherwise google; garmin__sleep; flights",
      },
      hold: {
        type: "string",
        description: "short (default, 27h) or brief (6h)",
      },
    },
    required: ["prefixes"],
  };
  return {
    name: ENABLE_TOOL_NAME,
    description: "Enable MCP tool-name prefixes for this chat so their schemas are sent on the next model call. "
      + "The prefix is a key copied from [mcp prefixes]: google__calendar only when that key is listed, otherwise the server id google. "
      + "A tool already in this turn's list is called now — do not mcp_enable it, and do not invent a key. "
      + "Default hold is short (27h idle). hold=brief is 6h (this morning/afternoon only). "
      + "Use brief when the job is only today-for-a-few-hours (flights this afternoon). "
      + "Pass every prefix this turn needs in one call. When google__calendar is listed, enable that, not the whole google server.",
    inputSchema: parameters,
  };
}

/** `mcp_enable`. Unknown prefixes are skipped in the text; a list over the cap is a tool error. */
export function runEnableTool(
  store: EnableStore | null,
  args: Record<string, unknown>,
  sessionId: string,
  index: readonly string[],
): ToolResult {
  if (!store) {
    return errorResult(toolErrorText("mcpenable: store not configured"));
  }
  if (!sessionId.trim()) {
    return errorResult(toolErrorText("mcpenable: no session"));
  }
  let parsed: { prefixes: string[]; hold: string };
  try {
    parsed = parseEnableArgs(args);
  } catch (err) {
    return errorResult(toolErrorText(errorMessage(err)));
  }
  let outcome: EnableOutcome;
  try {
    outcome = store.enable(sessionId, parsed.prefixes, parsed.hold, SOURCE_AGENT, index);
  } catch (err) {
    return errorResult(toolErrorText(errorMessage(err)));
  }
  return textResult(enableMessage(outcome, parsed.hold));
}

export class EnableStore {
  constructor(sql: Sql, clock: Clock, sessionId = agentSession) {
    this.sql = sql;
    this.clock = clock;
    migrateTools(sql);
    collapseSession(sql, roomSession(sessionId));
    // OpenDB rewrote `long` on every open, not only the first migration.
    sql.exec("UPDATE mcp_enable SET hold = ? WHERE hold = ?", HOLD_SHORT, LEGACY_HOLD);
  }

  /** Non-expired rows for one session. Expires idle rows first. */
  list(sessionId: string): EnableRow[] {
    const id = sessionId.trim();
    if (!id) {
      return [];
    }
    this.expire();
    const rows = this.sql.exec<EnableSqlRow>(
      "SELECT session_id, prefix, hold, source, last_used FROM mcp_enable WHERE session_id = ?",
      id,
    );
    const out: EnableRow[] = [];
    for (const row of rows) {
      const lastUsed = Number(row.last_used);
      if (!Number.isFinite(lastUsed)) {
        continue;
      }
      out.push({
        sessionId: row.session_id,
        prefix: row.prefix,
        hold: row.hold === LEGACY_HOLD ? HOLD_SHORT : row.hold,
        source: row.source,
        lastUsed,
      });
    }
    return out;
  }

  /** Delete idle rows (brief 6h, everything else 27h). */
  expire(): void {
    const now = this.clock.now();
    this.sql.exec(
      `DELETE FROM mcp_enable WHERE
        (hold = ? AND last_used < ?) OR
        (hold != ? AND last_used < ?)`,
      HOLD_BRIEF,
      now - BRIEF_IDLE_MS,
      HOLD_BRIEF,
      now - SHORT_IDLE_MS,
    );
  }

  /**
   * Upsert prefixes. `hold` is brief or short (anything else is short).
   * `source` is human or agent. A human row stays human when the agent
   * refreshes it; the new hold still applies.
   */
  enable(
    sessionId: string,
    prefixes: readonly string[],
    hold: string,
    source: string,
    index: readonly string[],
  ): EnableOutcome {
    const id = sessionId.trim();
    if (!id) {
      throw new Error("mcpenable: empty session_id");
    }
    const nextHold = normalizeHold(hold);
    const nextSource = source === SOURCE_HUMAN ? SOURCE_HUMAN : SOURCE_AGENT;
    if (prefixes.length > MAX_ENABLE_LIST) {
      throw new Error(`mcpenable: at most ${MAX_ENABLE_LIST} prefixes per call`);
    }
    const now = this.clock.now();
    const sourceByPrefix = new Map(this.list(id).map((row) => [row.prefix, row.source]));
    const landed: string[] = [];
    const failed: string[] = [];
    for (const raw of prefixes) {
      const key = raw.trim();
      if (!key) {
        continue;
      }
      if (!index.includes(key)) {
        failed.push(`${key} (unknown prefix)`);
        continue;
      }
      const sourceToWrite = sourceByPrefix.get(key) === SOURCE_HUMAN && nextSource === SOURCE_AGENT
        ? SOURCE_HUMAN
        : nextSource;
      sourceByPrefix.set(key, sourceToWrite);
      this.sql.exec(
        `INSERT INTO mcp_enable (session_id, prefix, hold, source, last_used)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id, prefix) DO UPDATE SET
           hold = excluded.hold,
           source = excluded.source,
           last_used = excluded.last_used`,
        id,
        key,
        nextHold,
        sourceToWrite,
        now,
      );
      landed.push(key);
    }
    return { landed, failed };
  }

  off(sessionId: string, prefix: string): void {
    this.sql.exec(
      "DELETE FROM mcp_enable WHERE session_id = ? AND prefix = ?",
      sessionId.trim(),
      prefix.trim(),
    );
  }

  /** Refresh `last_used` on the longest enabled prefix that matches `toolName`. */
  touch(sessionId: string, toolName: string): void {
    const rows = this.list(sessionId);
    const key = longestKey(toolName, rows.map((row) => row.prefix));
    if (!key) {
      return;
    }
    this.sql.exec(
      "UPDATE mcp_enable SET last_used = ? WHERE session_id = ? AND prefix = ?",
      this.clock.now(),
      sessionId.trim(),
      key,
    );
  }

  private readonly sql: Sql;
  private readonly clock: Clock;
}

/** One prefix survives (newest `last_used`). Then every row is labeled with the room session id. */
function collapseSession(sql: Sql, sid: string): void {
  sql.exec(
    `DELETE FROM mcp_enable
     WHERE rowid IN (
       SELECT a.rowid FROM mcp_enable AS a
       JOIN mcp_enable AS b
         ON a.prefix = b.prefix
        AND (
          a.last_used < b.last_used
          OR (a.last_used = b.last_used AND a.rowid > b.rowid)
        )
     )`,
  );
  sql.exec("UPDATE mcp_enable SET session_id = ? WHERE session_id != ?", sid, sid);
}

function enableMessage(outcome: EnableOutcome, hold: string): string {
  const parts: string[] = [];
  if (outcome.landed.length > 0) {
    parts.push(`enabled ${outcome.landed.join(", ")} (${normalizeHold(hold)}) — schemas on the next model call`);
  }
  if (outcome.failed.length > 0) {
    parts.push(`skipped: ${outcome.failed.join("; ")}`);
  }
  if (parts.length === 0) {
    return "nothing enabled";
  }
  return parts.join(". ");
}

function parseEnableArgs(args: Record<string, unknown>): { prefixes: string[]; hold: string } {
  const raw = args.prefixes;
  if (raw !== undefined && !Array.isArray(raw)) {
    throw new Error("mcpenable: bad arguments");
  }
  const prefixes: string[] = [];
  for (const item of raw ?? []) {
    if (typeof item !== "string") {
      throw new Error("mcpenable: bad arguments");
    }
    prefixes.push(item);
  }
  const hold = typeof args.hold === "string" ? args.hold : "";
  return { prefixes, hold };
}

function renderIndex(parts: { active: string[]; idle: string[] }): string {
  if (parts.active.length === 0 && parts.idle.length === 0) {
    return "";
  }
  let text = "[mcp prefixes] Review on vs off this turn. Need an off prefix? mcp_enable it (schemas on the next model call), then call the tool. Never bluff a missing tool that is listed off. ";
  text += parts.active.length > 0 ? `on: ${parts.active.join("; ")}` : "on: (none)";
  if (parts.idle.length > 0) {
    text += ` | off: ${parts.idle.join(", ")}`;
  }
  return text;
}

function indexParts(
  rows: readonly EnableRow[],
  index: readonly string[],
  force: Force,
  now: number | null,
): { active: string[]; idle: string[] } {
  const items: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const prefix of force.prefixes) {
    if (!prefix || seen.has(prefix)) {
      continue;
    }
    seen.add(prefix);
    items.push({ key: prefix, label: `${prefix} (force)` });
  }
  for (const row of rows) {
    if (seen.has(row.prefix) || forceCoversKey(row.prefix, force)) {
      continue;
    }
    seen.add(row.prefix);
    let label = `${row.prefix} (${row.hold})`;
    if (now !== null) {
      label = `${row.prefix} (${row.hold}, ${formatAge(now - row.lastUsed)} ago)`;
    }
    items.push({ key: row.prefix, label });
  }
  items.sort((a, b) => compare(a.key, b.key));
  const idle: string[] = [];
  for (const key of index) {
    if (seen.has(key) || forceCoversName(key, force) || forceCoversKey(key, force)) {
      continue;
    }
    idle.push(key);
  }
  return { active: items.map((item) => item.label), idle };
}

function forceCoversName(name: string, force: Force): boolean {
  return force.prefixes.some((prefix) => matches(name, prefix));
}

function forceCoversKey(key: string, force: Force): boolean {
  return force.prefixes.some((prefix) => prefix === key || key.startsWith(`${prefix}__`) || prefix.startsWith(`${key}__`));
}

/** Go `time.Duration` string for an age rounded to the nearest minute. */
function formatAge(ms: number): string {
  const clamped = ms < 0 ? 0 : ms;
  const minutes = Math.round(clamped / 60_000);
  if (minutes <= 0) {
    return "0s";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) {
    return `${hours}h${rest}m0s`;
  }
  return `${minutes}m0s`;
}

function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

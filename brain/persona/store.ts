/**
 * Operator persona files in the Durable Object's SQLite. One row per
 * markdown name. There is no persona directory on disk.
 */
import { type Clock } from "@/brain/core/clock";
import { type Logger } from "@/brain/core/log";
import { migrate, type Migration, type Sql, type SqlValue } from "@/brain/core/sql";
import { utf8Length } from "@/brain/selfnote/stamp";

/**
 * UTF-8 byte cap for one file. Same number as the agent config text limit
 * (`TEXT_MAX`, 262144).
 */
export const MAX_CHARS = 262_144;

/** Basename: letters, digits, `_`, `.`, `-`, and a `.md` suffix. */
const namePattern = /^[A-Za-z0-9_.-]+\.md$/;

/**
 * `list` order. PERSONA.md then SELF.md, matching `preferredOrder`.
 * Kept here so this file does not import the persona barrel.
 */
const kernelOrder = ["PERSONA.md", "SELF.md"];

/** Row `importLegacy` writes. Same basename `assemblePersona` reads. */
const legacyFile = "PERSONA.md";

export const personaMigrations: Migration[] = [
  {
    id: "persona.001",
    up: [
      `CREATE TABLE IF NOT EXISTS persona_file (
        name TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
];

export type PersonaFile = {
  name: string;
  text: string;
  updatedAt: number;
};

export class PersonaStore {
  private readonly log: Logger;

  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    log: Logger,
    agentId?: string,
  ) {
    this.log = log.with(agentId ? { pkg: "persona", agentId } : { pkg: "persona" });
    const applied = migrate(this.sql, personaMigrations);
    if (applied.length > 0) {
      this.log.info("persona migrated", { applied });
    }
  }

  /** Kernel files first (PERSONA.md, SELF.md), then every other name A–Z. */
  list(): PersonaFile[] {
    const when = kernelOrder.map((_, i) => `WHEN ? THEN ${String(i)}`).join(" ");
    const query = `SELECT name, text, updated_at FROM persona_file ORDER BY CASE name ${when} ELSE ${String(kernelOrder.length)} END, name`;
    return this.sql.exec(query, ...kernelOrder).map((row) => ({
      name: asString(row.name),
      text: asString(row.text),
      updatedAt: asNumber(row.updated_at),
    }));
  }

  /** Stored text, or null when that name is absent. */
  read(name: string): string | null {
    this.checkName(name);
    const row = this.sql.one("SELECT text FROM persona_file WHERE name = ?", name);
    if (!row) {
      return null;
    }
    return asString(row.text);
  }

  /**
   * Insert or replace. The name is a markdown basename. Text longer than
   * `MAX_CHARS` UTF-8 bytes is refused.
   */
  write(name: string, text: string): void {
    this.checkName(name);
    const chars = utf8Length(text);
    if (chars > MAX_CHARS) {
      throw new Error(`persona: text is ${String(chars)} bytes; max ${String(MAX_CHARS)}`);
    }
    this.sql.exec(
      `INSERT INTO persona_file (name, text, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
      name,
      text,
      this.clock.now(),
    );
    this.log.debug("persona updated", { name, chars });
  }

  /** Delete one row. A missing name is a no-op. */
  remove(name: string): void {
    this.checkName(name);
    this.sql.exec("DELETE FROM persona_file WHERE name = ?", name);
    if (this.sql.changes() > 0) {
      this.log.debug("persona removed", { name });
    }
  }

  /**
   * Seed PERSONA.md from the old config string. No-op when any row exists,
   * or when `text` is blank — a blank config must not block a later seed.
   * The stored text is the string as given. Returns whether a row was written.
   */
  importLegacy(text: string): boolean {
    if (this.sql.one("SELECT name FROM persona_file LIMIT 1")) {
      return false;
    }
    if (text.trim() === "") {
      return false;
    }
    this.write(legacyFile, text);
    return true;
  }

  private checkName(name: string): void {
    if (name === "") {
      throw new Error("persona: empty name");
    }
    if (!namePattern.test(name)) {
      throw new Error(`persona: bad name ${JSON.stringify(name)}`);
    }
  }
}

function asString(value: SqlValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: SqlValue | bigint | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return 0;
}

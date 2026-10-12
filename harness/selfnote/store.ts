/**
 * SELF.md — the one persona file the agent may write. Text lives in the
 * `selfnote` table, one row per agent. There is no filesystem.
 */
import type { Clock } from "@/harness/core/clock";
import type { Logger } from "@/harness/core/log";
import { migrate, type Migration, type Sql } from "@/harness/core/sql";
import { clipUtf8, fileName, maxChars, stamp, utf8Length } from "./stamp";

export const selfRowId = "self";

export const selfnoteMigrations: Migration[] = [
  {
    id: "selfnote.001",
    up: [
      `CREATE TABLE IF NOT EXISTS selfnote (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
];

export type SelfNoteOptions = {
  /** Row id. One Durable Object is one agent, so the default is a single row. */
  agentId?: string;
  onChange?: () => void;
};

function fields(s: string): string[] {
  return s.trim().split(/\s+/u).filter((part) => part !== "");
}

export class SelfNoteStore {
  /** Runs after every successful append or write — the persona reload hook. */
  onChange?: () => void;
  private readonly agentId: string;

  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    private readonly log: Logger,
    options: SelfNoteOptions = {},
  ) {
    this.agentId = options.agentId ?? selfRowId;
    this.onChange = options.onChange;
    migrate(this.sql, selfnoteMigrations);
    this.persistStamp();
  }

  /** Current content. A missing row reads back as the kernel header. */
  read(): string {
    return stamp(this.readRaw());
  }

  /** One note line. Newlines are flattened. Refuses when the file is at the cap. */
  append(note: string): void {
    const flat = fields(note).join(" ");
    if (flat === "") {
      throw new Error("selfnote: empty note");
    }
    const cur = this.read();
    const next = `${stamp(cur)}\n- ${flat}`;
    if (utf8Length(next) > maxChars) {
      throw new Error(`selfnote: ${fileName} is full (${String(utf8Length(cur))}/${String(maxChars)} chars) — it is rewritten compactly on /new, or the operator can prune it`);
    }
    this.writeRaw(next);
    this.changed();
  }

  /**
   * Replaces the whole note (the distill-on-reset path). Clips to `maxChars`
   * on a UTF-8 boundary. Empty content is refused — a distill that produced
   * nothing must not erase an existing personality.
   */
  write(content: string): void {
    let text = content.trim();
    if (text === "") {
      throw new Error(`selfnote: refusing to write empty ${fileName}`);
    }
    text = stamp(text);
    if (utf8Length(text) > maxChars) {
      text = clipUtf8(text, maxChars);
    }
    this.writeRaw(text);
    this.changed();
  }

  private persistStamp(): void {
    const cur = this.readRaw();
    const next = stamp(cur);
    if (cur === next) {
      return;
    }
    this.writeRaw(next);
  }

  private readRaw(): string {
    const row = this.sql.one<{ body: string }>(`SELECT body FROM selfnote WHERE id = ?`, this.agentId);
    return (row?.body ?? "").trim();
  }

  private writeRaw(body: string): void {
    this.sql.exec(
      `INSERT INTO selfnote (id, body, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      this.agentId,
      body,
      this.clock.now(),
    );
  }

  private changed(): void {
    this.log.debug("selfnote updated", { chars: utf8Length(this.readRaw()) });
    this.onChange?.();
  }
}

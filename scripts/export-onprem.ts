#!/usr/bin/env node
/**
 * Export on-prem Agent DO SQLite (gantry.db) into JSON for cloud import.
 *
 *   npm run export-onprem -- --db /path/to/gantry.db --out migrate.json
 *   npm run export-onprem -- --db ./gantry.db   # writes JSON to stdout
 */
import { createWriteStream, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  emptyBundle,
  type AimBlockRow,
  type AimEventRow,
  type AimScoreRow,
  type MemoryRow,
  type OnPremBundle,
  type PersonaFileRow,
  type SelfnoteRow,
} from "../lib/migrate/onprem.ts";

export function parseExportArgs(argv: readonly string[]): { help: boolean; db: string; out: string | null } {
  let db = "";
  let out: string | null = null;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--db=")) {
      db = arg.slice("--db=".length);
    } else if (arg === "--db") {
      db = argv[i + 1] ?? "";
      i += 1;
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else if (arg === "--out") {
      out = argv[i + 1] ?? "";
      i += 1;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return { help, db, out };
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare(
    "SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(name) as { n?: number } | undefined;
  return row?.n === 1;
}

function selectAll<T>(db: DatabaseSync, sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

export function exportOnPremDatabase(db: DatabaseSync): OnPremBundle {
  const bundle = emptyBundle();
  if (tableExists(db, "memory")) {
    bundle.memory.rows = selectAll<MemoryRow>(
      db,
      `SELECT id, kind, subject, content, source, confidence, created_at, updated_at,
              expires_at, superseded_by, consolidated, consolidate_attempts
       FROM memory ORDER BY id ASC`,
    );
  }
  if (tableExists(db, "aim_event")) {
    bundle.aim_event.rows = selectAll<AimEventRow>(
      db,
      `SELECT id, day, what, ref, metric, value, unit, source, created_at, superseded_by
       FROM aim_event ORDER BY id ASC`,
    );
  }
  if (tableExists(db, "aim_score")) {
    bundle.aim_score.rows = selectAll<AimScoreRow>(
      db,
      `SELECT event_id, area, score, note FROM aim_score ORDER BY event_id ASC, area ASC`,
    );
  }
  if (tableExists(db, "aim_block")) {
    bundle.aim_block.rows = selectAll<AimBlockRow>(
      db,
      `SELECT area, from_day, to_day FROM aim_block ORDER BY area ASC`,
    );
  }
  if (tableExists(db, "persona_file")) {
    bundle.persona_file.rows = selectAll<PersonaFileRow>(
      db,
      "SELECT name, text, updated_at FROM persona_file ORDER BY name ASC",
    );
  }
  if (tableExists(db, "selfnote")) {
    bundle.selfnote.rows = selectAll<SelfnoteRow>(
      db,
      "SELECT id, body, updated_at FROM selfnote ORDER BY id ASC",
    );
  }
  return bundle;
}

export function exportCounts(bundle: OnPremBundle): Record<string, number> {
  return {
    memory: bundle.memory.rows.length,
    aim_event: bundle.aim_event.rows.length,
    aim_score: bundle.aim_score.rows.length,
    aim_block: bundle.aim_block.rows.length,
    persona_file: bundle.persona_file.rows.length,
    selfnote: bundle.selfnote.rows.length,
  };
}

async function main(argv: string[]): Promise<void> {
  const args = parseExportArgs(argv);
  if (args.help) {
    process.stdout.write(
      "usage: export-onprem.ts --db <sqlite> [--out <json>]\n",
    );
    return;
  }
  if (!args.db) {
    throw new Error("usage: export-onprem.ts --db <path> [--out <json>]");
  }
  if (!existsSync(args.db)) {
    throw new Error(`database not found: ${args.db}`);
  }
  const db = new DatabaseSync(args.db, { readOnly: true });
  try {
    const bundle = exportOnPremDatabase(db);
    const json = `${JSON.stringify(bundle)}\n`;
    const counts = exportCounts(bundle);
    process.stderr.write(
      `exported memory=${String(counts.memory)} aim_event=${String(counts.aim_event)} `
      + `aim_score=${String(counts.aim_score)} aim_block=${String(counts.aim_block)} `
      + `persona_file=${String(counts.persona_file)} selfnote=${String(counts.selfnote)}\n`,
    );
    if (args.out) {
      await pipeline(Readable.from([json]), createWriteStream(args.out));
    } else {
      process.stdout.write(json);
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "export failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

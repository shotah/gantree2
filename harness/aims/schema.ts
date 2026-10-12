import { type Migration } from "@/harness/core/sql";

/**
 * Ledger tables from docs/contract.md. Live rows are `superseded_by IS NULL`.
 * The partial unique index lets one live `ref` exist; a rewrite retires the
 * old row before inserting the next.
 */
export const AIM_MIGRATIONS: Migration[] = [
  {
    id: "aims.001",
    up: [
      `CREATE TABLE IF NOT EXISTS aim_event (
        id INTEGER PRIMARY KEY,
        day TEXT NOT NULL,
        what TEXT NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        metric TEXT NOT NULL DEFAULT '',
        value REAL,
        unit TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        superseded_by INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS aim_score (
        event_id INTEGER NOT NULL REFERENCES aim_event(id),
        area TEXT NOT NULL,
        score INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (event_id, area)
      )`,
      `CREATE TABLE IF NOT EXISTS aim_block (
        area TEXT PRIMARY KEY,
        from_day TEXT NOT NULL,
        to_day TEXT NOT NULL
      )`,
    ],
  },
  {
    id: "aims.002",
    up: [
      `CREATE UNIQUE INDEX IF NOT EXISTS aim_event_ref
        ON aim_event(ref) WHERE ref != '' AND superseded_by IS NULL`,
      `CREATE INDEX IF NOT EXISTS aim_event_day ON aim_event(day)`,
    ],
  },
];

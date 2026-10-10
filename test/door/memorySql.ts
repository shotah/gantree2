import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { Sql } from "@/lib/door/settingsStore";

/** In-memory stand-in for Durable Object SQL. `exec().toArray()` matches `Sql`. */
export function memorySql(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query, ...binds) {
      const found = db.prepare(query).all(...(binds as SQLInputValue[]));
      return { toArray: () => found };
    },
  };
}

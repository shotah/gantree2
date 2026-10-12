import { DatabaseSync } from "node:sqlite";
import { fixedClock, makeLogger, memorySink, nodeSql, type NodeDatabase } from "@/harness/core";
import { MemoryStore, type Entry } from "@/harness/memory";

export const AT = Date.parse("2026-08-25T12:00:00.000Z");

function memoryDb(): NodeDatabase {
  // DatabaseSync types its bindings narrower than SqlValue; the runtime accepts them.
  return new DatabaseSync(":memory:") as unknown as NodeDatabase;
}

export function memorySql() {
  return nodeSql(memoryDb());
}

export function openMemory(at = AT, zone = "UTC") {
  const sql = memorySql();
  const clock = fixedClock(at, zone);
  const sink = memorySink();
  const store = new MemoryStore(sql, clock, makeLogger(sink, () => clock.now()));
  return { sql, clock, sink, store };
}

export function entry(partial: Partial<Entry> & Pick<Entry, "subject">): Entry {
  return {
    id: 0,
    kind: "fact",
    source: "chat",
    confidence: 1,
    content: "",
    createdAt: 0,
    updatedAt: 0,
    expiresAt: null,
    supersededBy: null,
    ...partial,
  };
}

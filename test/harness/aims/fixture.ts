import { DatabaseSync } from "node:sqlite";
import { fixedClock, zoneOffsetMs, type Clock } from "@/harness/core/clock";
import { silentLogger } from "@/harness/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/harness/core/sql";
import { openAims, type AimMemory, type AimNote, type AimStore } from "@/harness/aims";

export const LA = "America/Los_Angeles";

export class Mem implements AimMemory {
  private rows: AimNote[] = [];

  put(subject: string, content: string): void {
    this.rows = [{ subject, content }, ...this.rows.filter((row) => row.subject !== subject)];
  }

  seed(...areas: string[]): void {
    for (const area of areas) {
      this.put(`aim/${area}`, `${area} aim`);
    }
  }

  listAims(): readonly AimNote[] {
    return this.rows.filter((row) => row.subject.startsWith("aim/"));
  }

  sentence(area: string): string | null {
    return this.rows.find((row) => row.subject === `aim/${area}`)?.content ?? null;
  }
}

/** Epoch ms for a civil time in `zone`, with the same DST correction as `atLocalTime`. */
export function localInstant(zone: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
  const utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = utc - zoneOffsetMs(utc, zone);
  return utc - zoneOffsetMs(guess, zone);
}

/** Independent of the package calendar, so a bad `addDays` fails the fixture dates. */
export function shiftDay(day: string, n: number): string {
  const parts = day.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const date = Number(parts[2]);
  if (!parts[0] || !parts[1] || !parts[2] || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(date)) {
    throw new Error(`bad day ${day}`);
  }
  return new Date(Date.UTC(year, month - 1, date + n)).toISOString().slice(0, 10);
}

export function openFixture(zone = "UTC", at = Date.UTC(2026, 8, 27, 12, 0, 0)): {
  store: AimStore;
  mem: Mem;
  clock: Clock & { set(at: number): void; tick(ms: number): void };
  sql: Sql;
} {
  // DatabaseSync bindings are narrower than SqlValue; the runtime accepts both.
  const sql = nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
  const clock = fixedClock(at, zone);
  const mem = new Mem();
  const store = openAims(sql, clock, silentLogger, mem);
  return { store, mem, clock, sql };
}

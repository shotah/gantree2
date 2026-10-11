import { atLocalTime, localParts, type Clock } from "@/brain/core/clock";
import { migrate, type Migration, type Sql, type SqlValue } from "@/brain/core/sql";

/** Free app-only tier. One read is one `posts_list` handle that hits the API. */
export const DEFAULT_MONTHLY_READS = 100;

const migrations: Migration[] = [
  {
    id: "twitter.001",
    up: [
      `CREATE TABLE IF NOT EXISTS twitter_read (
        month TEXT PRIMARY KEY,
        reads INTEGER NOT NULL
      )`,
    ],
  },
];

export type ReadBudget = {
  limit: number;
  used: number;
  /** First instant of the next calendar month in `zone`. */
  resetsAt: number;
  month: string;
};

/** `X_MONTHLY_READS`. Blank or junk stays at the free-tier default. `0` is a real cap. */
export function monthlyReadLimit(env: Readonly<Record<string, string>>): number {
  const raw = (env.X_MONTHLY_READS ?? "").trim();
  if (raw === "") return DEFAULT_MONTHLY_READS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MONTHLY_READS;
  return Math.trunc(n);
}

export function readBudget(sql: Sql, now: number, zone: string, limit: number): ReadBudget {
  migrate(sql, migrations);
  const z = zone.trim() || "UTC";
  const month = monthKey(now, z);
  const row = sql.one<{ reads: SqlValue }>("SELECT reads FROM twitter_read WHERE month = ?", month);
  return {
    limit,
    used: row ? asNumber(row.reads) : 0,
    resetsAt: nextMonthStart(now, z),
    month,
  };
}

/**
 * Count one read if the month still has room. A refusal does not increment.
 * The poller and `posts_list` share `twitter_read`.
 */
export function consumeRead(sql: Sql, now: number, zone: string, limit: number): { ok: boolean; budget: ReadBudget } {
  const budget = readBudget(sql, now, zone, limit);
  if (budget.used >= budget.limit) return { ok: false, budget };
  sql.exec("UPDATE twitter_read SET reads = reads + 1 WHERE month = ?", budget.month);
  if (sql.changes() === 0) {
    sql.exec("INSERT INTO twitter_read (month, reads) VALUES (?, 1)", budget.month);
  }
  return { ok: true, budget: { ...budget, used: budget.used + 1 } };
}

export function budgetMessage(budget: ReadBudget): string {
  return `X monthly read budget (${String(budget.limit)}) is used; resets ${rfc3339(budget.resetsAt)}`;
}

/** Non-null when this twitter watch must wait out the month. Other tools are never skipped. */
export function twitterSkip(
  sql: Sql,
  clock: Clock,
  limit: number,
  tool: string,
): { until: number; message: string } | null {
  if (tool.trim() !== "twitter__posts_list") return null;
  const budget = readBudget(sql, clock.now(), clock.zone || "UTC", limit);
  if (budget.used < budget.limit) return null;
  return { until: budget.resetsAt, message: budgetMessage(budget) };
}

function monthKey(now: number, zone: string): string {
  const p = localParts(now, zone);
  return `${String(p.year)}-${String(p.month).padStart(2, "0")}`;
}

function nextMonthStart(now: number, zone: string): number {
  const p = localParts(now, zone);
  const year = p.month === 12 ? p.year + 1 : p.year;
  const month = p.month === 12 ? 1 : p.month + 1;
  return atMonthStart(year, month, zone);
}

function atMonthStart(year: number, month: number, zone: string): number {
  let guess = Date.UTC(year, month - 1, 1, 12, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const got = localParts(guess, zone);
    if (got.year === year && got.month === month && got.day === 1) break;
    if (got.year > year || got.month > month || (got.year === year && got.month === month && got.day > 1)) {
      guess -= 86_400_000;
    } else {
      guess += 86_400_000;
    }
  }
  return atLocalTime(guess, zone, 0, 0);
}

function rfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function asNumber(v: SqlValue | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

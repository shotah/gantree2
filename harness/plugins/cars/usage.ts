import { localParts, type Clock } from "@/harness/core/clock.ts";
import { migrate, type Sql } from "@/harness/core/sql.ts";

export const defaultMonthlyQuota = 500;

export type Usage = {
  requestsUsed: number;
  requestsLeft: number;
  requestsPerMonth: number;
  period: string;
  periodResets: string;
  source: string;
  persistent: boolean;
  note?: string;
};

const usageNote = "Local counter of successful MarketCheck calls from this machine/binary. "
  + "Not the official dashboard — MarketCheck billing period may differ from calendar month. "
  + "Verify at https://developers.marketcheck.com/ when unsure. Free plan ≈ 500 calls/mo.";

function disabledEnv(value: string | undefined): boolean {
  switch ((value ?? "").trim().toLowerCase()) {
    case "0":
    case "false":
    case "off":
    case "no":
      return true;
    default:
      return false;
  }
}

function positiveInt(value: string | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function migrateCars(sql: Sql): void {
  migrate(sql, [{
    id: "plugin.cars.001",
    up: [`CREATE TABLE IF NOT EXISTS cars_usage (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      period TEXT NOT NULL,
      count INTEGER NOT NULL
    )`],
  }]);
}

type Stored = { period: string; count: number };

export type UsageTracker = {
  readonly disabled: boolean;
  snapshot(): Usage | null;
  recordSuccess(): void;
};

export function usageTracker(env: Readonly<Record<string, string>>, sql: Sql, clock: Clock): UsageTracker {
  migrateCars(sql);
  if (disabledEnv(env["MARKETCHECK_USAGE_TRACK"])) {
    return {
      disabled: true,
      snapshot: () => null,
      recordSuccess: () => undefined,
    };
  }
  let quota = positiveInt(env["MARKETCHECK_MONTHLY_QUOTA"]);
  if (quota <= 0) {
    quota = defaultMonthlyQuota;
  }
  let loaded = false;
  let period = "";
  let count = 0;

  const currentPeriod = (): string => {
    const parts = localParts(clock.now(), clock.zone);
    return `${String(parts.year)}-${String(parts.month).padStart(2, "0")}`;
  };

  const load = (): void => {
    if (loaded) {
      if (period !== currentPeriod()) {
        period = currentPeriod();
        count = 0;
      }
      return;
    }
    loaded = true;
    const nowPeriod = currentPeriod();
    const row = sql.one<Stored>("SELECT period, count FROM cars_usage WHERE id = 1");
    if (row === null || row.period !== nowPeriod) {
      period = nowPeriod;
      count = 0;
      return;
    }
    period = row.period;
    count = row.count;
  };

  const persist = (): void => {
    sql.exec(
      `INSERT INTO cars_usage (id, period, count) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET period = excluded.period, count = excluded.count`,
      period,
      count,
    );
  };

  const snapshot = (): Usage => {
    load();
    const left = count >= quota ? 0 : quota - count;
    return {
      requestsUsed: count,
      requestsLeft: left,
      requestsPerMonth: quota,
      period,
      periodResets: periodResets(period),
      source: "local_counter",
      persistent: true,
      note: usageNote,
    };
  };

  return {
    disabled: false,
    snapshot,
    recordSuccess(): void {
      load();
      count += 1;
      persist();
    },
  };
}

function periodResets(period: string): string {
  const [yearRaw, monthRaw] = period.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return "";
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${String(nextYear)}-${String(nextMonth).padStart(2, "0")}-01`;
}

export function usageJSON(usage: Usage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    requests_used: usage.requestsUsed,
    requests_left: usage.requestsLeft,
    requests_per_month: usage.requestsPerMonth,
    period: usage.period,
    period_resets: usage.periodResets,
    source: usage.source,
    persistent: usage.persistent,
  };
  if (usage.note !== undefined && usage.note !== "") {
    out["note"] = usage.note;
  }
  return out;
}

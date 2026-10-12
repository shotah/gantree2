import { localParts, type Clock } from "@/harness/core/clock.ts";
import { migrate, type Sql } from "@/harness/core/sql.ts";

export const defaultMonthlyQuota = 50;
const defaultSoftCapGap = 10;

export type Usage = {
  requestsUsed: number;
  requestsLeft: number;
  requestsPerMonth: number;
  softCap: number;
  capState: string;
  confirmRequired: boolean;
  hardCapped: boolean;
  allowOverage: boolean;
  period: string;
  periodResets: string;
  source: string;
  persistent: boolean;
  quotaWarning?: string;
  note?: string;
};

export class QuotaError extends Error {
  readonly kind: "soft" | "hard";
  readonly usage: Usage | null;

  constructor(kind: "soft" | "hard", usage: Usage | null) {
    super(quotaMessage(kind, usage));
    this.name = "QuotaError";
    this.kind = kind;
    this.usage = usage;
  }
}

function quotaMessage(kind: "soft" | "hard", usage: Usage | null): string {
  const used = usage?.requestsUsed ?? 0;
  const per = usage?.requestsPerMonth ?? 0;
  const left = usage?.requestsLeft ?? 0;
  const resets = usage?.periodResets ?? "";
  if (kind === "hard") {
    return `HARD CAP (${String(used)}/${String(per)} used). Call was NOT sent — 0 RentCast requests billed. Do not retry listings_search, listings_get, rent_estimate_get, or markets_get. Use link_format (free) or wait until ${resets}. A human who upgraded the RentCast plan can set RENTCAST_ALLOW_OVERAGE=1 in the MCP env; the model cannot unlock this.`;
  }
  return `SOFT CAP (${String(used)}/${String(per)} used, ${String(left)} left this month). Call was NOT sent — 0 RentCast requests billed. Re-call this same tool with confirm_spend=true to spend 1 of the remaining ${String(left)}. Combine neighborhoods/zips/types into ONE listings_search, or use link_format (free). confirm_spend cannot bypass the hard cap of ${String(per)}. Local counter resets ${resets}.`;
}

const usageNote = "Local counter of successful RentCast calls from this machine/binary. Resets on the 1st of each calendar month (local time) — period_resets is that date. Soft cap requires confirm_spend=true on billed tools; hard cap cannot be bypassed by the model. Not the official dashboard; RentCast's billing cycle may differ. Verify at https://app.rentcast.io/ when unsure.";

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

function enabledEnv(value: string | undefined): boolean {
  switch ((value ?? "").trim().toLowerCase()) {
    case "1":
    case "true":
    case "on":
    case "yes":
      return true;
    default:
      return false;
  }
}

function positiveInt(value: string | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nonNegativeInt(value: string | undefined): number | null {
  const raw = (value ?? "").trim();
  if (raw === "") {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

export function migrateRentals(sql: Sql): void {
  migrate(sql, [{
    id: "plugin.rentals.001",
    up: [`CREATE TABLE IF NOT EXISTS rentals_usage (
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
  gate(confirmSpend: boolean): QuotaError | null;
  recordSuccess(): void;
};

export function usageTracker(env: Readonly<Record<string, string>>, sql: Sql, clock: Clock): UsageTracker {
  migrateRentals(sql);
  if (disabledEnv(env["RENTCAST_USAGE_TRACK"])) {
    return {
      disabled: true,
      snapshot: () => null,
      gate: () => null,
      recordSuccess: () => undefined,
    };
  }
  let quota = positiveInt(env["RENTCAST_MONTHLY_QUOTA"]);
  if (quota <= 0) {
    quota = defaultMonthlyQuota;
  }
  const softRaw = nonNegativeInt(env["RENTCAST_SOFT_CAP"]);
  const softCap = softRaw === null ? (quota > defaultSoftCapGap ? quota - defaultSoftCapGap : 0) : softRaw;
  const allowOverage = enabledEnv(env["RENTCAST_ALLOW_OVERAGE"]);
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
    const row = sql.one<Stored>("SELECT period, count FROM rentals_usage WHERE id = 1");
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
      `INSERT INTO rentals_usage (id, period, count) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET period = excluded.period, count = excluded.count`,
      period,
      count,
    );
  };

  const snapshot = (): Usage => {
    load();
    const left = count >= quota ? 0 : quota - count;
    let capState = "ok";
    let quotaWarning: string | undefined;
    let confirmRequired = false;
    let hardCapped = false;
    if (allowOverage && count >= quota) {
      capState = "overage";
      quotaWarning = "Local count is at or past the monthly quota; RENTCAST_ALLOW_OVERAGE=1 is set. Dashboard remains source of truth.";
    } else if (count >= quota) {
      capState = "exhausted";
      hardCapped = true;
      quotaWarning = "Hard cap reached. Do not retry billed tools. Use link_format or wait until period_resets. The model cannot unlock this.";
    } else if (softCap > 0 && count >= softCap) {
      capState = "confirm_required";
      confirmRequired = true;
      quotaWarning = "Soft cap reached. Next billed call requires confirm_spend=true (1 of the remaining requests). Or use link_format (free).";
    }
    const usage: Usage = {
      requestsUsed: count,
      requestsLeft: left,
      requestsPerMonth: quota,
      softCap,
      capState,
      confirmRequired,
      hardCapped,
      allowOverage,
      period,
      periodResets: periodResets(period),
      source: "local_counter",
      persistent: true,
      note: usageNote,
    };
    if (quotaWarning !== undefined) {
      usage.quotaWarning = quotaWarning;
    }
    return usage;
  };

  return {
    disabled: false,
    snapshot,
    gate(confirmSpend: boolean): QuotaError | null {
      const usage = snapshot();
      if (usage.hardCapped) {
        return new QuotaError("hard", usage);
      }
      if (usage.confirmRequired && !confirmSpend) {
        return new QuotaError("soft", usage);
      }
      return null;
    },
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
    soft_cap: usage.softCap,
    cap_state: usage.capState,
    confirm_required: usage.confirmRequired,
    hard_capped: usage.hardCapped,
    allow_overage: usage.allowOverage,
    period: usage.period,
    period_resets: usage.periodResets,
    source: usage.source,
    persistent: usage.persistent,
  };
  if (usage.quotaWarning !== undefined && usage.quotaWarning !== "") {
    out["quota_warning"] = usage.quotaWarning;
  }
  if (usage.note !== undefined && usage.note !== "") {
    out["note"] = usage.note;
  }
  return out;
}

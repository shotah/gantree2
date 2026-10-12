import type { Sql } from "@/harness/core/sql";
import { migrate, type Migration } from "@/harness/core/sql";
import type { StoredCookie } from "./cookies";
import { errorMessage, GarminError, isRecord, parseJson } from "./json";

export const garminMigrations: Migration[] = [
  {
    id: "plugin.garmin.001",
    up: [
      `CREATE TABLE IF NOT EXISTS garmin_mfa_pending (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    ],
  },
];

export function ensureGarminSchema(sql: Sql): void {
  migrate(sql, garminMigrations);
}

export type MfaPending = {
  domain: string;
  loginParams: Record<string, string[]>;
  mfaMethod: string;
  cookies: StoredCookie[];
  expiresAt: number;
  state: string;
  redirectUri: string;
};

const MISSING = "garmin: no pending MFA (run 'garmin login url' / /auth garmin first)";
const EXPIRED = "garmin: MFA pending expired — run /auth garmin again";

export function savePending(sql: Sql, pending: MfaPending): void {
  ensureGarminSchema(sql);
  const payload = JSON.stringify({
    cookies: pending.cookies,
    domain: pending.domain,
    loginParams: pending.loginParams,
    mfaMethod: pending.mfaMethod,
    redirectUri: pending.redirectUri,
    state: pending.state,
  });
  sql.exec(
    `INSERT INTO garmin_mfa_pending (id, payload, expires_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`,
    payload,
    pending.expiresAt,
  );
}

export function clearPending(sql: Sql): void {
  ensureGarminSchema(sql);
  sql.exec("DELETE FROM garmin_mfa_pending WHERE id = 1");
}

export function loadPending(sql: Sql, now: number): MfaPending {
  ensureGarminSchema(sql);
  const row = sql.one<{ payload: string; expires_at: number }>(
    "SELECT payload, expires_at FROM garmin_mfa_pending WHERE id = 1",
  );
  if (!row) throw new GarminError(MISSING);
  if (now > row.expires_at) {
    clearPending(sql);
    throw new GarminError(EXPIRED);
  }
  return decodePending(row.payload, row.expires_at);
}

function decodePending(payload: string, expiresAt: number): MfaPending {
  let parsed: unknown;
  try {
    parsed = parseJson(payload);
  } catch (err) {
    throw new GarminError(`garmin: corrupt MFA pending: ${errorMessage(err)}`);
  }
  if (!isRecord(parsed)) throw new GarminError("garmin: corrupt MFA pending: not an object");
  const domain = typeof parsed.domain === "string" && parsed.domain !== "" ? parsed.domain : "garmin.com";
  const mfaMethod = typeof parsed.mfaMethod === "string" && parsed.mfaMethod !== "" ? parsed.mfaMethod : "email";
  return {
    cookies: decodeCookies(parsed.cookies),
    domain,
    expiresAt,
    loginParams: decodeParams(parsed.loginParams),
    mfaMethod,
    redirectUri: typeof parsed.redirectUri === "string" ? parsed.redirectUri : "",
    state: typeof parsed.state === "string" ? parsed.state : "",
  };
}

function decodeParams(value: unknown): Record<string, string[]> {
  if (value == null) return {};
  if (!isRecord(value)) throw new GarminError("garmin: corrupt MFA pending: login params");
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) throw new GarminError("garmin: corrupt MFA pending: login params");
    const items: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") throw new GarminError("garmin: corrupt MFA pending: login params");
      items.push(item);
    }
    out[key] = items;
  }
  return out;
}

function decodeCookies(value: unknown): StoredCookie[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new GarminError("garmin: corrupt MFA pending: cookies");
  const out: StoredCookie[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.value !== "string") {
      throw new GarminError("garmin: corrupt MFA pending: cookies");
    }
    const cookie: StoredCookie = { name: item.name, value: item.value };
    if (typeof item.path === "string") cookie.path = item.path;
    if (typeof item.domain === "string") cookie.domain = item.domain;
    if (item.secure === true) cookie.secure = true;
    if (item.httpOnly === true) cookie.httpOnly = true;
    out.push(cookie);
  }
  return out;
}

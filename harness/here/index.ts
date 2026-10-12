/**
 * Last known location per session. The harness kept this in memory and lost
 * it on restart; the Durable Object stores it in SQLite so a pin survives
 * eviction. `at === 0` is "no pin", the same as Go's zero time.
 */
import { localParts, type Clock } from "@/harness/core/clock";
import type { Logger } from "@/harness/core/log";
import { migrate, type Migration, type Sql } from "@/harness/core/sql";
import { agentSession, roomSession } from "@/harness/session/types";

export const hereMigrations: Migration[] = [
  {
    id: "here.001",
    up: [
      `CREATE TABLE IF NOT EXISTS here_pin (
        session_id TEXT PRIMARY KEY,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        accuracy_m REAL NOT NULL DEFAULT 0,
        at INTEGER NOT NULL
      )`,
    ],
  },
];

/** This-send coordinates. `label` is a venue title. `accuracyM` is meters; 0 means unknown. */
export type GeoPoint = {
  lat: number;
  lon: number;
  label?: string;
  accuracyM?: number;
};

export type Pin = {
  lat: number;
  lon: number;
  label: string;
  accuracyM: number;
  at: number;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Prompt-side "how long ago": just now, 5m ago, 3h ago, 12d ago. */
export function age(deltaMs: number): string {
  let d = deltaMs;
  if (d < 0) {
    d = 0;
  }
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (d < minute) {
    return "just now";
  }
  if (d < hour) {
    return `${String(Math.trunc(d / minute))}m ago`;
  }
  if (d < day) {
    return `${String(Math.trunc(d / hour))}h ago`;
  }
  return `${String(Math.trunc(d / day))}d ago`;
}

function formatStamp(ms: number, zone: string): string {
  const p = localParts(ms, zone);
  const suffix = p.hour >= 12 ? "PM" : "AM";
  let hour = p.hour % 12;
  if (hour === 0) {
    hour = 12;
  }
  const minute = String(p.minute).padStart(2, "0");
  const wd = weekdays[p.weekday] ?? "Sun";
  const mon = months[p.month - 1] ?? "Jan";
  return `${wd} ${mon} ${String(p.day)}, ${String(p.year)} ${String(hour)}:${minute} ${suffix}`;
}

function zoneAbbr(ms: number, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type === "timeZoneName") {
      return part.value;
    }
  }
  return zone;
}

function formatZone(ms: number, zone: string, tzName: string): string {
  const name = tzName === "" ? zone : tzName;
  const abbr = zoneAbbr(ms, zone);
  if (abbr !== "" && abbr !== name) {
    return abbr;
  }
  return name;
}

/**
 * Prompt line for the user-turn time footer. Empty if `pin.at` is 0.
 * `zone` is the location of `nowMs` (Go's `now.Location()`). `tzName` is the
 * label the harness passes beside it; the abbreviation wins when they differ.
 */
export function formatPin(pin: Pin, nowMs: number, tzName: string, zone = "UTC"): string {
  if (pin.at === 0) {
    return "";
  }
  const tag = pin.accuracyM > 0 ? `[location ±${String(Math.round(pin.accuracyM))}m]` : "[location]";
  let line = `${tag} ${pin.lat.toFixed(6)}, ${pin.lon.toFixed(6)} at ${formatStamp(pin.at, zone)} ${formatZone(pin.at, zone, tzName)} (${age(nowMs - pin.at)})`;
  if (pin.label !== "") {
    line += ` — ${pin.label}`;
  }
  return line;
}

/** The newest pin survives. Then its label is the room session id. */
function collapseSession(sql: Sql, sid: string): void {
  sql.exec(
    `DELETE FROM here_pin
     WHERE rowid IN (
       SELECT a.rowid FROM here_pin AS a
       JOIN here_pin AS b
         ON a.at < b.at OR (a.at = b.at AND a.rowid > b.rowid)
     )`,
  );
  sql.exec("UPDATE here_pin SET session_id = ? WHERE session_id != ?", sid, sid);
}

type PinRow = {
  lat: number;
  lon: number;
  label: string;
  accuracy_m: number;
  at: number;
};

export class HereStore {
  constructor(
    private readonly sql: Sql,
    private readonly clock: Clock,
    private readonly log: Logger,
    sessionId = agentSession,
  ) {
    migrate(this.sql, hereMigrations);
    collapseSession(this.sql, roomSession(sessionId));
  }

  /** Stores this-send GPS. A null geo or a zero `at` is ignored. */
  remember(sessionId: string, geo: GeoPoint | null, at: number): void {
    if (!geo || !Number.isFinite(at) || at === 0) {
      return;
    }
    this.set(sessionId, {
      lat: geo.lat,
      lon: geo.lon,
      label: geo.label ?? "",
      accuracyM: geo.accuracyM ?? 0,
      at,
    });
  }

  set(sessionId: string, pin: Pin): void {
    const id = sessionId.trim();
    if (id === "" || !Number.isFinite(pin.at) || pin.at === 0) {
      return;
    }
    this.sql.exec(
      `INSERT INTO here_pin (session_id, lat, lon, label, accuracy_m, at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         lat = excluded.lat,
         lon = excluded.lon,
         label = excluded.label,
         accuracy_m = excluded.accuracy_m,
         at = excluded.at`,
      id,
      pin.lat,
      pin.lon,
      pin.label,
      pin.accuracyM,
      pin.at,
    );
    this.log.debug("here pin", { session_id: id });
  }

  get(sessionId: string): Pin | null {
    const id = sessionId.trim();
    if (id === "") {
      return null;
    }
    const row = this.sql.one<PinRow>(
      `SELECT lat, lon, label, accuracy_m, at FROM here_pin WHERE session_id = ?`,
      id,
    );
    if (!row) {
      return null;
    }
    return {
      lat: row.lat,
      lon: row.lon,
      label: row.label,
      accuracyM: row.accuracy_m,
      at: row.at,
    };
  }

  /** Prompt line for `sessionId` at the injected clock, or empty when no pin. */
  format(sessionId: string, tzName = this.clock.zone): string {
    const pin = this.get(sessionId);
    if (!pin) {
      return "";
    }
    return formatPin(pin, this.clock.now(), tzName, this.clock.zone);
  }
}

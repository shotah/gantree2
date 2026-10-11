/** Calendar time windows. Mirrors the helpers in tools/calendar.go. Clock is injected. */

export function correctTimeFormatForAPI(t: string): string {
  if (t === "") {
    return "";
  }
  if (t.length === 10 && !t.includes("T")) {
    return `${t}T00:00:00Z`;
  }
  if (t.includes("T") && !t.includes("Z") && !t.includes("+")) {
    const tail = t.length >= 6 ? t.slice(-6) : "";
    if (!tail.includes("+") && !tail.includes("-")) {
      return `${t}Z`;
    }
  }
  return t;
}

export function isAllDay(t: string): boolean {
  return !t.includes("T");
}

export function rfc3339Utc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/u, "Z");
}

export function resolveListWindow(timeMin: string, timeMax: string, nowMs: number): { min: string; max: string; defaultedMax: boolean } {
  let min = correctTimeFormatForAPI(timeMin);
  if (min === "") {
    min = rfc3339Utc(nowMs);
  }
  let max = correctTimeFormatForAPI(timeMax);
  let defaultedMax = false;
  if (max === "") {
    max = defaultTimeMaxAfter(min, nowMs);
    defaultedMax = true;
  }
  return { min, max, defaultedMax };
}

export function defaultTimeMaxAfter(timeMinRfc3339: string, nowMs: number): string {
  const parsed = parseRfc3339(timeMinRfc3339);
  if (!parsed) {
    return rfc3339Utc(nowMs + 24 * 60 * 60 * 1000);
  }
  return formatOffset(parsed.utcMs + 24 * 60 * 60 * 1000, parsed.zone);
}

function parseRfc3339(s: string): { utcMs: number; zone: string } | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/u.exec(s);
  if (!m) {
    return undefined;
  }
  const zone = m[7] ?? "Z";
  const offsetMin = zone === "Z" ? 0 : zoneOffsetMinutes(zone);
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - offsetMin * 60_000;
  return { utcMs, zone };
}

function zoneOffsetMinutes(zone: string): number {
  const sign = zone.startsWith("-") ? -1 : 1;
  return sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
}

function formatOffset(utcMs: number, zone: string): string {
  const offsetMin = zone === "Z" ? 0 : zoneOffsetMinutes(zone);
  const local = new Date(utcMs + offsetMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const body = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  return zone === "Z" ? `${body}Z` : `${body}${zone}`;
}

/** Values models mistake for event ids (calendar id "primary", dates, ranges). */
export function bogusCalendarEventID(s: string): boolean {
  const trimmed = s.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "") {
    return false;
  }
  if (lower === "primary" || lower === "secondary") {
    return true;
  }
  if (lower.includes(" to ") || /[ \t\n]/u.test(s)) {
    return true;
  }
  if (lower.length === 10 && lower[4] === "-" && lower[7] === "-") {
    let ok = true;
    for (let i = 0; i < lower.length; i += 1) {
      if (i === 4 || i === 7) {
        continue;
      }
      const r = lower[i] ?? "";
      if (r < "0" || r > "9") {
        ok = false;
        break;
      }
    }
    if (ok) {
      return true;
    }
  }
  if (lower.includes("t") && (lower.includes(":") || lower.includes("-") || lower.includes("z") || lower.includes("+"))) {
    for (const r of lower) {
      if (r >= "0" && r <= "9") {
        return true;
      }
    }
  }
  return false;
}

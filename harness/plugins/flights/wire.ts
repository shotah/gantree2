/** Query encoding and JSON text matching Go's `url.Values` and `encoding/json`. */

export function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()~*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** Sorted keys, `+` for spaces — `url.Values.Encode`. */
export function encodeQuery(params: Record<string, string>): string {
  return Object.keys(params).sort().map((key) => `${queryEscape(key)}=${queryEscape(params[key] ?? "")}`).join("&");
}

/** `encoding/json` HTML escapes so tool text matches the Go MCP result. */
export function goJSON(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) {
    return "null";
  }
  return text.replace(/[&<>]/g, (ch) => {
    if (ch === "&") {
      return "\\u0026";
    }
    if (ch === "<") {
      return "\\u003c";
    }
    return "\\u003e";
  });
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Half away from zero, like Go `%.0f` / `math.Round`. */
export function round0(value: number): string {
  const negative = value < 0;
  const rounded = Math.floor(Math.abs(value) + 0.5);
  return negative ? `-${String(rounded)}` : String(rounded);
}

export function mathRound(value: number): number {
  const negative = value < 0;
  const rounded = Math.floor(Math.abs(value) + 0.5);
  return negative ? -rounded : rounded;
}

export function parseJSON(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

export function redact(message: string, secret: string): string {
  if (secret === "") {
    return message;
  }
  return message.split(secret).join("[redacted]");
}

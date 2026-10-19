/** Query encoding and JSON text matching Go's `url.Values` and `encoding/json`. */

export function queryEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()~*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

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

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function intNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
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

export function sortedRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) {
      out[key] = item;
    }
  }
  return out;
}

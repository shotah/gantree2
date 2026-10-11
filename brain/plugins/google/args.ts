import { errorResult, type ToolResult } from "@/brain/core/tools";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function needArg(arg: string, nextCall: string): ToolResult {
  return errorResult(`${arg} is required. Next: ${nextCall}`);
}

export function toolHint(msg: string, nextCall: string): ToolResult {
  return errorResult(`${msg}. Next: ${nextCall}`);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "google tool failed";
}

export function hasKey(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key);
}

/** Present string, including "". Missing or non-string is undefined (RequireString failure). */
export function requireString(args: Record<string, unknown>, key: string): string | undefined {
  if (!hasKey(args, key)) {
    return undefined;
  }
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

export function getString(args: Record<string, unknown>, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === "string" ? v : fallback;
}

/** mcp-go GetInt: truncate numbers; Atoi for integer strings; otherwise the fallback. */
export function getInt(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string" && /^-?\d+$/u.test(v)) {
    return Number.parseInt(v, 10);
  }
  return fallback;
}

/** strconv.ParseBool plus numeric nonzero, matching mcp-go GetBool. */
export function getBool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "number") {
    return v !== 0;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "t" || s === "true") {
      return true;
    }
    if (s === "0" || s === "f" || s === "false") {
      return false;
    }
  }
  return fallback;
}

/** drive.getBool: only a real boolean overrides the default. Strings stay at the fallback. */
export function getBoolOnly(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (!hasKey(args, key) || args[key] == null) {
    return fallback;
  }
  const v = args[key];
  return typeof v === "boolean" ? v : fallback;
}

/** mcp-go RequireString failure (`required argument %q not found`). */
export class ArgTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgTypeError";
  }
}

export function requireArgString(args: Record<string, unknown>, key: string): string {
  if (!hasKey(args, key)) {
    throw new ArgTypeError(`required argument ${JSON.stringify(key)} not found`);
  }
  const v = args[key];
  if (typeof v !== "string") {
    throw new ArgTypeError(`argument ${JSON.stringify(key)} is not a string`);
  }
  return v;
}

/** Skips non-strings. Undefined when the key is absent or not an array (getStringSlice). */
export function getStringSlice(args: Record<string, unknown>, key: string): string[] | undefined {
  if (!hasKey(args, key) || args[key] == null) {
    return undefined;
  }
  const v = args[key];
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      out.push(item);
    }
  }
  return out;
}

/**
 * RequireStringSlice. Undefined means the handler should treat it as missing
 * (wrong type, absent, or a non-string element). An empty array is present.
 */
export function requireStringSlice(args: Record<string, unknown>, key: string): string[] | undefined {
  if (!hasKey(args, key) || args[key] == null) {
    return undefined;
  }
  const v = args[key];
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") {
      return undefined;
    }
    out.push(item);
  }
  return out;
}

export function mapString(m: Record<string, unknown>, key: string): string | undefined {
  const v = m[key];
  return typeof v === "string" ? v : undefined;
}

export function mapBool(m: Record<string, unknown>, key: string): boolean | undefined {
  const v = m[key];
  return typeof v === "boolean" ? v : undefined;
}

export function mapStringSlice(m: Record<string, unknown>, key: string): string[] | undefined {
  if (!hasKey(m, key) || m[key] == null) {
    return undefined;
  }
  const v = m[key];
  if (!Array.isArray(v)) {
    return undefined;
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      out.push(item);
    }
  }
  return out;
}

export function firstNonEmpty(...values: string[]): string {
  for (const v of values) {
    if (v.trim() !== "") {
      return v.trim();
    }
  }
  return "";
}

export function strField(v: unknown, key: string): string {
  if (!isRecord(v)) {
    return "";
  }
  const x = v[key];
  return typeof x === "string" ? x : "";
}

export function boolField(v: unknown, key: string): boolean {
  return isRecord(v) && v[key] === true;
}

export function numField(v: unknown, key: string): number {
  if (!isRecord(v)) {
    return 0;
  }
  const x = v[key];
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

export function arrField(v: unknown, key: string): unknown[] {
  if (!isRecord(v)) {
    return [];
  }
  const x = v[key];
  return Array.isArray(x) ? x : [];
}

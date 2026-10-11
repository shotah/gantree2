import type { OAuthToken, ToolResult } from "@/brain/core/tools";
import { errorResult } from "@/brain/core/tools";

export class StravaError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, body: string) {
    super(`Strava API error (${statusCode}): ${body}`);
    this.name = "StravaError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function getInt(args: Record<string, unknown>, key: string, fallback: number): number {
  if (!Object.hasOwn(args, key)) return fallback;
  const value = args[key];
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^[+-]?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fallback;
}

const trueLiterals = new Set(["1", "t", "T", "true", "TRUE", "True"]);
const falseLiterals = new Set(["0", "f", "F", "false", "FALSE", "False"]);

export function getBool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (!Object.hasOwn(args, key)) return fallback;
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (trueLiterals.has(value)) return true;
    if (falseLiterals.has(value)) return false;
    return fallback;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

/** Pretty-print like `json.Indent`. Invalid JSON is returned unchanged, with no rate-limit note. */
export function formatResponse(data: string, warning: string): string {
  try {
    const pretty = JSON.stringify(JSON.parse(data), null, 2);
    return warning ? `${pretty}\n\n${warning}` : pretty;
  } catch {
    return data;
  }
}

export const FETCH_CAP = 4;
export const ID_CAP = 20;

/** Run `fn` over `items` with at most `limit` in flight. Result order matches `items`. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(limit, 0), items.length);
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await fn(item);
    }
  }
  if (workers === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

export function parseJsonBody(data: string): unknown {
  const value: unknown = JSON.parse(data);
  return value;
}

export function failureText(toolName: string, err: unknown): string {
  const result = toolError(toolName, err);
  const first = result.content[0];
  return first?.type === "text" ? first.text : errorMessage(err);
}

export function toolError(toolName: string, err: unknown): ToolResult {
  const stravaErr = findStrava(err);
  if (stravaErr) {
    return errorResult(`${toolName}: Strava API error (${stravaErr.statusCode}): ${stravaErr.body}`);
  }
  return errorResult(`${toolName}: ${errorMessage(err)}`);
}

function findStrava(err: unknown): StravaError | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof StravaError) return current;
    seen.add(current);
    current = current.cause;
  }
  return null;
}

/** Strava token JSON: `expires_at` is unix seconds. Stored `expiresAt` is ms. */
export function toOAuthToken(parsed: unknown): OAuthToken {
  if (!isRecord(parsed)) throw new Error("invalid JSON");
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  const refreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
  const expiresAt = typeof parsed.expires_at === "number" && Number.isFinite(parsed.expires_at)
    ? parsed.expires_at * 1000
    : 0;
  const token: OAuthToken = { accessToken, expiresAt, refreshToken };
  if (typeof parsed.token_type === "string" && parsed.token_type !== "") {
    token.tokenType = parsed.token_type;
  }
  return token;
}

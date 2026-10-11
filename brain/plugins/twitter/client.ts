/**
 * X API v2 app-only client. Bearer stays on the Authorization header.
 */

export const defaultBaseURL = "https://api.x.com";
const defaultTimeoutMs = 15_000;
const defaultMaxBytes = 2 << 20;
const apiMinResults = 5;
const apiMaxResults = 100;

export class APIError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;

  constructor(status: number, title: string, detail: string) {
    const msg = detail.trim() || title.trim() || `HTTP ${status}`;
    super(`X API: ${msg}`);
    this.name = "APIError";
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

export function isAPIError(err: unknown): err is APIError {
  return err instanceof APIError;
}

export type XUser = { id: string; username: string };
export type XTweet = { id: string; text: string };

export type XClient = {
  baseURL: string;
  token: string;
  maxBytes: number;
  fetch: typeof fetch;
  signal?: AbortSignal;
};

export function missingTokenError(): Error {
  return new Error("X_BEARER_TOKEN is not set. Next: set X_BEARER_TOKEN on this process (app-only Bearer from developer.x.com), then posts_list(handle=\"foo\")");
}

export function clientFromEnv(env: Readonly<Record<string, string>>, fetchImpl: typeof fetch, signal?: AbortSignal): XClient {
  const token = (env.X_BEARER_TOKEN ?? "").trim();
  if (!token) throw missingTokenError();
  return { baseURL: defaultBaseURL, token, maxBytes: defaultMaxBytes, fetch: fetchImpl, signal };
}

export async function lookupUser(client: XClient, username: string): Promise<XUser> {
  const path = `/2/users/by/username/${encodeURIComponent(username)}`;
  const { body, status } = await xget(client, path);
  if (status !== 200) throw parseAPIError(status, body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (err) {
    throw new Error(`user lookup: ${err instanceof Error ? err.message : "invalid json"}`, { cause: err });
  }
  const data = isRecord(parsed) ? parsed.data : undefined;
  const rec = isRecord(data) ? data : undefined;
  const id = rec && typeof rec.id === "string" ? rec.id.trim() : "";
  if (!id) throw new APIError(404, "Not Found", "user not found");
  const name = rec && typeof rec.username === "string" ? rec.username.trim() : "";
  return { id, username: name || username };
}

export async function listTweets(client: XClient, userID: string, limit: number): Promise<XTweet[]> {
  const maxResults = Math.min(Math.max(limit, apiMinResults), apiMaxResults);
  const path = `/2/users/${encodeURIComponent(userID)}/tweets`;
  const { body, status } = await xget(client, path, { max_results: String(maxResults) });
  if (status !== 200) throw parseAPIError(status, body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (err) {
    throw new Error(`tweet list: ${err instanceof Error ? err.message : "invalid json"}`, { cause: err });
  }
  const data = isRecord(parsed) ? parsed.data : undefined;
  const rows = Array.isArray(data) ? data : [];
  const out: XTweet[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    out.push({ id, text: typeof row.text === "string" ? row.text : "" });
    if (out.length >= limit) break;
  }
  return out;
}

export function parseAPIError(status: number, body: string): APIError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    parsed = undefined;
  }
  const rec = isRecord(parsed) ? parsed : undefined;
  let detail = rec && typeof rec.detail === "string" ? rec.detail.trim() : "";
  let title = rec && typeof rec.title === "string" ? rec.title.trim() : "";
  const errors = rec && Array.isArray(rec.errors) ? rec.errors : [];
  for (const item of errors) {
    if (!isRecord(item)) continue;
    if (!detail) {
      const d = typeof item.detail === "string" ? item.detail : "";
      const m = typeof item.message === "string" ? item.message : "";
      detail = (d || m).trim();
    }
    if (!title && typeof item.title === "string") title = item.title.trim();
  }
  return new APIError(status, title, detail);
}

async function xget(client: XClient, path: string, query?: Record<string, string>): Promise<{ body: string; status: number }> {
  const base = client.baseURL || defaultBaseURL;
  let url: URL;
  try {
    url = new URL(base);
  } catch (err) {
    throw new Error(`base url: ${err instanceof Error ? err.message : "invalid"}`, { cause: err });
  }
  url.pathname = url.pathname.replace(/\/$/, "") + path;
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  const maxBytes = client.maxBytes > 0 ? client.maxBytes : defaultMaxBytes;
  const signal = AbortSignal.any([
    AbortSignal.timeout(defaultTimeoutMs),
    ...(client.signal ? [client.signal] : []),
  ]);
  let res: Response;
  try {
    res = await client.fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        Authorization: `Bearer ${client.token}`,
        Accept: "application/json",
        "User-Agent": "twitter-mcp/0.1 (+https://github.com/shotah/twitter-mcp)",
      },
    });
  } catch (err) {
    throw err instanceof Error ? err : new Error("request failed");
  }
  const body = await readLimitedText(res, maxBytes);
  return { body, status: res.status };
}

async function readLimitedText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`response larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("response larger than")) throw err;
    throw err instanceof Error ? err : new Error("read failed");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

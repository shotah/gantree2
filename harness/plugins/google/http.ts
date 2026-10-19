import type { OAuthToken, PluginContext } from "@/harness/core/tools";
import { isRecord } from "@/harness/plugins/google/args";
import { AuthFailed, freshToken, providerForEmail, refreshToken } from "@/harness/plugins/google/oauth";

export type Query = Record<string, string | number | boolean | string[] | undefined>;

/** Multipart or other non-JSON body. `send` posts `payload` with `contentType`. */
export class RawBody {
  constructor(readonly contentType: string, readonly payload: string) {}
}

export class GoogleApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`googleapi: Error ${status}: ${detail}`);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export type RawHttp = { status: number; text: string };

export type GoogleClient = {
  get(url: string, query?: Query): Promise<unknown>;
  post(url: string, body: unknown, query?: Query): Promise<unknown>;
  put(url: string, body: unknown, query?: Query): Promise<unknown>;
  patch(url: string, body: unknown, query?: Query): Promise<unknown>;
  delete(url: string, query?: Query): Promise<void>;
  /** Status and body, including non-2xx. Handlers that format HTTP errors themselves use this. */
  text(method: string, url: string, body?: unknown, query?: Query): Promise<RawHttp>;
};

/**
 * Authenticated JSON client. Loads `google:<email>` (or the sole unnamed legacy
 * row) and writes a refresh back to that same provider id.
 */
export async function connect(ctx: PluginContext, email: string, signal?: AbortSignal): Promise<GoogleClient> {
  let provider: string;
  let tok: OAuthToken;
  try {
    provider = await providerForEmail(ctx, email);
    tok = await freshToken(ctx, provider, signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "no credentials";
    throw new Error(`authenticating for ${email}: ${msg}`, { cause: e });
  }
  const holder = { token: tok, provider };
  const call = async (method: string, url: string, body: unknown, query: Query | undefined): Promise<unknown> => {
    const res = await send(ctx, holder, method, url, body, query, signal, false);
    if (res.status === 204 || (res.status === 200 && isEmptyResponse(res))) {
      return undefined;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new GoogleApiError(res.status, errorDetail(text, res.status));
    }
    if (!text.trim()) {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GoogleApiError(res.status, text.trim());
    }
  };
  return {
    get: (url, query) => call("GET", url, undefined, query),
    post: (url, body, query) => call("POST", url, body, query),
    put: (url, body, query) => call("PUT", url, body, query),
    patch: (url, body, query) => call("PATCH", url, body, query),
    delete: async (url, query) => {
      const res = await send(ctx, holder, "DELETE", url, undefined, query, signal, false);
      if (res.ok) {
        await res.text();
        return;
      }
      const text = await res.text();
      throw new GoogleApiError(res.status, errorDetail(text, res.status));
    },
    text: async (method, url, body, query) => {
      const res = await send(ctx, holder, method, url, body, query, signal, false);
      return { status: res.status, text: await res.text() };
    },
  };
}

function isEmptyResponse(res: Response): boolean {
  return res.headers.get("content-length") === "0";
}

async function send(
  ctx: PluginContext,
  holder: { token: OAuthToken; provider: string },
  method: string,
  url: string,
  body: unknown,
  query: Query | undefined,
  signal: AbortSignal | undefined,
  retried: boolean,
): Promise<Response> {
  const raw = body instanceof RawBody ? body : undefined;
  const res = await ctx.fetch(withQuery(url, query), {
    method,
    headers: {
      authorization: `Bearer ${holder.token.accessToken}`,
      ...(raw ? { "content-type": raw.contentType } : body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: raw ? raw.payload : body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (res.status === 401 && !retried && holder.token.refreshToken) {
    await res.text();
    try {
      holder.token = await refreshToken(ctx, holder.provider, holder.token, signal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "token refresh failed";
      throw new AuthFailed(msg);
    }
    return send(ctx, holder, method, url, body, query, signal, true);
  }
  return res;
}

function withQuery(url: string, query: Query | undefined): string {
  const u = new URL(url);
  if (!query) {
    return u.toString();
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        u.searchParams.append(key, item);
      }
    } else {
      u.searchParams.append(key, String(value));
    }
  }
  return u.toString();
}

function errorDetail(text: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = typeof parsed.error.message === "string" ? parsed.error.message : "";
      const errors = parsed.error.errors;
      let reason = "";
      if (Array.isArray(errors) && isRecord(errors[0]) && typeof errors[0].reason === "string") {
        reason = errors[0].reason;
      }
      if (message && reason) {
        return `${message}, ${reason}`;
      }
      if (message) {
        return message;
      }
      if (reason) {
        return reason;
      }
    }
  } catch {
    // raw body
  }
  const trimmed = text.trim();
  return trimmed || `status ${status}`;
}

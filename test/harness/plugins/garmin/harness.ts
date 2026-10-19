import { DatabaseSync } from "node:sqlite";
import { fixedClock } from "@/harness/core/clock";
import { makeLogger, memorySink, type LogRecord, type LogSink } from "@/harness/core/log";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";
import type { OAuthToken, PluginContext, TokenStore, ToolResult } from "@/harness/core/tools";
import { resetRateLimiter } from "@/harness/plugins/garmin/http";

export const NOW = Date.UTC(2026, 0, 26, 15, 4, 5);
export const call = { sessionId: "s1", userId: "ada" };

export function memoryTokens(initial: OAuthToken | null = null): TokenStore & { token: OAuthToken | null } {
  const store: TokenStore & { token: OAuthToken | null } = {
    token: initial,
    async delete() {
      store.token = null;
    },
    async get() {
      return store.token;
    },
    async list() {
      return [];
    },
    async put(_provider, token) {
      store.token = token;
    },
  };
  return store;
}

export function jsonResponse(status: number, body: string, headers?: HeadersInit): Response {
  return new Response(body, { headers, status });
}

export function scripted(
  handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>,
): typeof fetch {
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(new URL(href), init);
  };
}

export function authed(over: Partial<OAuthToken> = {}): OAuthToken {
  return {
    accessToken: "access",
    expiresAt: NOW + 3_600_000,
    refreshToken: "refresh",
    ...over,
    extra: { diClientId: "client", domain: "garmin.com", ...(over.extra ?? {}) },
  };
}

export function jwt(payload: Record<string, unknown>, pad = false): string {
  const json = JSON.stringify(payload);
  let body = btoa(json).replace(/\+/g, "-").replace(/\//g, "_");
  if (!pad) body = body.replace(/=+$/g, "");
  return `hdr.${body}.sig`;
}

export function makeCtx(opts: {
  env?: Record<string, string>;
  fetch?: typeof fetch;
  token?: OAuthToken | null;
  now?: number;
  zone?: string;
} = {}): {
  ctx: PluginContext;
  tokens: ReturnType<typeof memoryTokens>;
  clock: ReturnType<typeof fixedClock>;
  sink: LogSink & { records: LogRecord[] };
} {
  resetRateLimiter();
  const clock = fixedClock(opts.now ?? NOW, opts.zone ?? "UTC");
  const tokens = memoryTokens(opts.token === undefined ? null : opts.token);
  const sink = memorySink();
  const ctx: PluginContext = {
    clock,
    env: opts.env ?? { GARMIN_EMAIL: "ada@example.com", GARMIN_PASSWORD: "secret" },
    fetch: opts.fetch ?? (async () => jsonResponse(200, "{}")),
    log: makeLogger(sink, () => clock.now()),
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    tokens,
  };
  return { clock, ctx, sink, tokens };
}

export function textOf(result: ToolResult): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected text content");
  return block.text;
}

export function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

export function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  return typeof body === "string" ? body : "";
}

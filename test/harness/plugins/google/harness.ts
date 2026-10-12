import { DatabaseSync } from "node:sqlite";
import { fixedClock } from "@/harness/core/clock";
import { makeLogger, memorySink } from "@/harness/core/log";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";
import { type OAuthToken, type PluginContext, type TokenStore, type ToolResult } from "@/harness/core/tools";
import { google } from "@/harness/plugins/google/index";

export const NOW = Date.parse("2026-07-28T15:00:00Z");

export type Hit = { method: string; url: URL; body: string; authorization: string };

export function memoryTokens(initial: Record<string, OAuthToken> = {}): TokenStore & { saved: Map<string, OAuthToken> } {
  const saved = new Map(Object.entries(initial));
  return {
    saved,
    get: async (provider) => saved.get(provider) ?? null,
    put: async (provider, token) => {
      saved.set(provider, token);
    },
    delete: async (provider) => {
      saved.delete(provider);
    },
  };
}

export function recordingFetch(handler: (hit: Hit) => Response | Promise<Response>): { fetch: typeof fetch; hits: Hit[] } {
  const hits: Hit[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    const hit: Hit = {
      method: (init?.method ?? "GET").toUpperCase(),
      url: new URL(href),
      body,
      authorization: headers.get("authorization") ?? "",
    };
    hits.push(hit);
    return handler(hit);
  };
  return { fetch: fetchImpl, hits };
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function testCtx(opts: {
  env?: Record<string, string>;
  token?: OAuthToken | null;
  fetch?: typeof fetch;
  now?: number;
} = {}): PluginContext & { tokens: TokenStore & { saved: Map<string, OAuthToken> } } {
  const tokens = memoryTokens(opts.token ? { google: opts.token } : {});
  const clock = fixedClock(opts.now ?? NOW, "UTC");
  return {
    env: opts.env ?? {
      GOOGLE_OAUTH_CLIENT_ID: "cid",
      GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
      USER_GOOGLE_EMAIL: "test@example.com",
      GOOGLE_TOOL_PRESET: "all",
    },
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    clock,
    log: makeLogger(memorySink(), () => clock.now()),
    fetch: opts.fetch ?? (async () => jsonResponse({})),
    tokens,
  };
}

export const liveToken = (extra: Record<string, string> = { email: "test@example.com" }): OAuthToken => ({
  accessToken: "ya29.access",
  refreshToken: "1//refresh",
  expiresAt: NOW + 60 * 60 * 1000,
  tokenType: "Bearer",
  extra,
});

export async function callTool(ctx: PluginContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = google.tools(ctx).find((t) => t.name === name);
  if (!tool) {
    throw new Error(`missing tool ${name}`);
  }
  return tool.call(args, { userId: "user", sessionId: "sess" });
}

export function textOf(result: ToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    return "";
  }
  return first.text;
}

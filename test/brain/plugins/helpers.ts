import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink, type LogRecord } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { type Plugin, type PluginContext, type ToolResult } from "@/brain/core/tools";

export const NOW = Date.parse("2026-01-01T00:00:00Z");

export function pluginCtx(opts: {
  env?: Record<string, string>;
  fetch?: typeof fetch;
  now?: number;
} = {}): PluginContext & { sink: { records: LogRecord[] }; clock: ReturnType<typeof fixedClock> } {
  const clock = fixedClock(opts.now ?? NOW, "UTC");
  const sink = memorySink();
  return {
    env: opts.env ?? {},
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    clock,
    log: makeLogger(sink, () => clock.now()),
    fetch: opts.fetch ?? (async () => new Response("")),
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    sink,
  };
}

export async function callTool(plugin: Plugin, ctx: PluginContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = plugin.tools(ctx).find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.call(args, { userId: "user", sessionId: "sess" });
}

export function textOf(result: ToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}

export function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

export function hrefOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const bufferApi = Buffer as unknown as {
  from(data: Uint8Array): { toString(encoding: "base64"): string };
};
const encodeB64 = (data: Uint8Array) => bufferApi.from(data);

export function b64(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return encodeB64(bytes).toString("base64");
}

export function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return "";
}

export function bodyBytes(body: BodyInit | null | undefined): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) {
    const out = new Uint8Array(body.byteLength);
    out.set(body);
    return out;
  }
  return new Uint8Array();
}

export function responseBytes(data: Uint8Array, status = 200, headers: Record<string, string> = {}): Response {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return new Response(copy, { status, headers });
}

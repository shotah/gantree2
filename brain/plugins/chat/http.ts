import type { ServerConfig } from "./config";
import { backdropMaxBytes } from "./jpeg";

const httpTimeoutMs = 15_000;
const bodyCap = backdropMaxBytes + 64 * 1024;

export type HttpGot = { status: number; header: (name: string) => string; body: Uint8Array };

export async function pendantRequest(cfg: ServerConfig, fetchImpl: typeof fetch, method: string, url: string, body: Uint8Array | undefined, contentType: string, signal?: AbortSignal): Promise<HttpGot> {
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.bearer}` };
  if (contentType) headers["Content-Type"] = contentType;
  const timeout = AbortSignal.timeout(httpTimeoutMs);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers,
      body: body ? (body as unknown as BodyInit) : undefined,
      signal: merged,
    });
  } catch {
    throw new Error("pendant request failed");
  }
  let raw: Uint8Array;
  try {
    raw = await readCap(res, bodyCap);
  } catch {
    throw new Error("pendant response failed");
  }
  return {
    status: res.status,
    header: (name) => res.headers.get(name) ?? "",
    body: raw,
  };
}

export function workerError(raw: Uint8Array, status: number): string {
  const text = new TextDecoder().decode(raw).trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed.error === "string" && parsed.error) return parsed.error;
      if (typeof parsed.detail === "string" && parsed.detail) return parsed.detail;
    }
  } catch {
    // not JSON
  }
  return text || `HTTP ${status}`;
}

export function parseWriteJSON(raw: Uint8Array): number {
  const text = new TextDecoder().decode(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(text);
  }
  if (!isRecord(parsed)) throw new Error(text);
  if (typeof parsed.error === "string" && parsed.error) throw new Error(parsed.error);
  return typeof parsed.rev === "number" ? parsed.rev : 0;
}

async function readCap(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const room = max - total;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, Math.max(0, room)));
      total = max;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

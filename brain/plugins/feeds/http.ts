/**
 * Size-capped GET. Redirects are followed by hand so a hop to a non-http URL
 * stops the same way the Go client did.
 */

export const defaultTimeoutMs = 15_000;
export const defaultMaxBytes = 2 << 20;
export const maxRedirects = 5;

const ACCEPT = "application/atom+xml, application/rss+xml, application/feed+json, application/json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5";

export const defaultUserAgent = "feeds-mcp/0.1 (+https://github.com/shotah/feeds-mcp)";

export function userAgentFrom(env: Readonly<Record<string, string>>): string {
  const ua = (env.FEEDS_USER_AGENT ?? "").trim();
  return ua || defaultUserAgent;
}

export function validateURL(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch (err) {
    return `url: ${err instanceof Error ? err.message : "invalid"}`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "url must be http or https";
  if (!u.host) return "url host is required";
  return null;
}

export type Got = { body: Uint8Array; contentType: string; finalURL: string };

export async function httpGet(opts: {
  fetch: typeof fetch;
  url: string;
  userAgent?: string;
  maxBytes?: number;
  signal?: AbortSignal;
}): Promise<Got> {
  const bad = validateURL(opts.url);
  if (bad) throw new Error(bad);
  const maxBytes = opts.maxBytes != null && opts.maxBytes > 0 ? opts.maxBytes : defaultMaxBytes;
  const ua = (opts.userAgent ?? "").trim() || defaultUserAgent;
  const signal = AbortSignal.any([
    AbortSignal.timeout(defaultTimeoutMs),
    ...(opts.signal ? [opts.signal] : []),
  ]);
  let current = opts.url;
  let redirects = 0;
  for (;;) {
    const res = await opts.fetch(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { "User-Agent": ua, Accept: ACCEPT },
    });
    if (res.status >= 300 && res.status < 400) {
      redirects += 1;
      if (redirects >= maxRedirects) throw new Error(`stopped after ${maxRedirects} redirects`);
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new Error(`stopped after ${redirects} redirects`);
      const next = new URL(loc, current).toString();
      const nextBad = validateURL(next);
      if (nextBad) throw new Error(nextBad);
      current = next;
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      throw new Error(`GET ${current}: HTTP ${res.status}`);
    }
    const body = await readLimited(res, maxBytes);
    let ct = res.headers.get("content-type") ?? "";
    const semi = ct.indexOf(";");
    if (semi >= 0) ct = ct.slice(0, semi).trim();
    return { body, contentType: ct.toLowerCase(), finalURL: current };
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch (err) {
      throw err instanceof Error ? err : new Error("read failed");
    }
    if (step.done) break;
    const value = step.value;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

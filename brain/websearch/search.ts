import { type CallContext, type Tool, type ToolResult, errorResult, textResult } from "@/brain/core/tools";
import { DEFAULT_COUNT, DEFAULT_ENDPOINT, ENV_API_KEY, HTTP_TIMEOUT_MS, MAX_QUERIES, isSearchTool, toolDefs } from "./tools";

export type WebSearchDeps = {
  /** Explicit key. Falls back to `env.BRAVE_SEARCH_API_KEY`. */
  apiKey?: string;
  env?: Readonly<Record<string, string>>;
  fetch?: typeof fetch;
  /** Tests point this at a fake Brave server. */
  endpoint?: string;
};

type BraveHit = { title: string; url: string; description: string };

/**
 * In-process Brave Search client. `open` refuses to publish a client without
 * a key. `new WebSearch()` with nothing configured still answers `call` with
 * `websearch: service is not configured`, matching an empty Go `Tools` value.
 */
export class WebSearch {
  readonly apiKey: string;
  readonly endpoint: string;
  private readonly fetchFn: typeof fetch | null;

  constructor(deps: WebSearchDeps = {}) {
    this.apiKey = resolveKey(deps);
    const endpoint = (deps.endpoint ?? "").trim();
    this.endpoint = endpoint === "" ? DEFAULT_ENDPOINT : endpoint;
    this.fetchFn = deps.fetch ?? null;
  }

  static open(deps: WebSearchDeps = {}): WebSearch {
    const client = new WebSearch(deps);
    if (client.apiKey === "") {
      throw new Error("BRAVE_SEARCH_API_KEY is required for web_search");
    }
    if (client.fetchFn === null) throw new Error("websearch: fetch is required");
    return client;
  }

  /** The `web_search` tool. Failures are `isError` text the model can read. */
  tool(): Tool {
    const def = toolDefs()[0];
    if (!def) throw new Error("websearch: missing tool definition");
    return {
      ...def,
      call: (args, ctx) => this.callTool(args, ctx),
    };
  }

  /**
   * Execute `web_search` or a leftover alias. Returns the formatted hits, or
   * throws the same errors the Go client returned.
   */
  async call(name: string, args: unknown, signal?: AbortSignal): Promise<string> {
    if (!isSearchTool(name)) throw new Error(`websearch: unknown tool ${goQuote(name)}`);
    if (this.apiKey === "" || this.fetchFn === null) {
      throw new Error("websearch: service is not configured");
    }
    return this.search(readQuery(args), signal);
  }

  async search(query: string, signal?: AbortSignal): Promise<string> {
    const q = query.trim();
    if (q === "") throw new Error("query is required");
    if (this.apiKey === "" || this.fetchFn === null) {
      throw new Error("websearch: service is not configured");
    }
    const fetchFn = this.fetchFn;
    let endpoint: URL;
    try {
      endpoint = new URL(this.endpoint);
    } catch (err) {
      throw new Error(`websearch: endpoint: ${errorText(err)}`, { cause: err });
    }
    endpoint.searchParams.set("q", q);
    endpoint.searchParams.set("count", String(DEFAULT_COUNT));
    const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let resp: Response;
    try {
      resp = await fetchFn(endpoint.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        signal: combined,
      });
    } catch (err) {
      throw new Error(`websearch: brave search failed: ${errorText(err)}`, { cause: err });
    }
    const status = statusLabel(resp);
    let body: string;
    try {
      body = await readLimited(resp, 1 << 20);
    } catch (err) {
      throw new Error(`websearch: read body: ${errorText(err)}`, { cause: err });
    }
    const parsed = tryParse(body);
    if (!parsed.ok) {
      throw new Error(`websearch: brave search failed (${status}): ${clipBody(body)}`);
    }
    const message = braveErrorMessage(parsed.value);
    if (message !== "") throw new Error(`websearch: brave search failed: ${message}`);
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`websearch: brave search failed (${status}): ${clipBody(body)}`);
    }
    return formatResults(q, readHits(parsed.value));
  }

  private async callTool(args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> {
    let queries: string[];
    try {
      queries = readQueries(args);
    } catch (err) {
      return errorResult(errorText(err));
    }
    if (queries.length === 0) return errorResult("query is required");
    if (queries.length > MAX_QUERIES) return errorResult(`queries accepts at most ${String(MAX_QUERIES)}`);
    const rows: Record<string, unknown>[] = [];
    for (const query of queries) {
      try {
        rows.push({ query, results: await this.search(query, ctx.signal) });
      } catch (err) {
        rows.push({ query, error: errorText(err) });
      }
    }
    return textResult(JSON.stringify(rows));
  }
}

function resolveKey(deps: WebSearchDeps): string {
  const direct = (deps.apiKey ?? "").trim();
  if (direct !== "") return direct;
  return (deps.env?.[ENV_API_KEY] ?? "").trim();
}

function argumentRecord(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) return {};
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed === "" || trimmed === "null") return {};
    const parsed = tryParse(trimmed);
    if (!parsed.ok) throw new Error(`websearch: bad arguments: ${parsed.error.message}`);
    return argumentRecord(parsed.value);
  }
  if (!isRecord(args)) throw new Error("websearch: bad arguments: expected object");
  return args;
}

function readQuery(args: unknown): string {
  const query = argumentRecord(args).query;
  return typeof query === "string" ? query : "";
}

function readQueries(args: unknown): string[] {
  const record = argumentRecord(args);
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const query = value.trim();
    if (query === "" || out.includes(query)) return;
    out.push(query);
  };
  if (Array.isArray(record.queries)) {
    for (const item of record.queries) push(item);
  }
  push(record.query);
  return out;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error("invalid JSON") };
  }
}

function braveErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  const err = isRecord(value.error) ? value.error : null;
  if (err && typeof err.detail === "string" && err.detail.trim() !== "") return err.detail.trim();
  return typeof value.message === "string" ? value.message.trim() : "";
}

function readHits(value: unknown): BraveHit[] {
  if (!isRecord(value)) return [];
  const web = isRecord(value.web) ? value.web : null;
  if (!web || web.results === undefined) return [];
  if (!isUnknownArray(web.results)) {
    throw new Error("websearch: brave search failed: results is not an array");
  }
  const hits: BraveHit[] = [];
  for (const raw of web.results) {
    if (!isRecord(raw)) continue;
    hits.push({
      title: typeof raw.title === "string" ? raw.title : "",
      url: typeof raw.url === "string" ? raw.url : "",
      description: typeof raw.description === "string" ? raw.description : "",
    });
  }
  return hits;
}

function formatResults(query: string, items: readonly BraveHit[]): string {
  if (items.length === 0) return `No results for ${goQuote(query)}`;
  const parts = [`Search results for ${goQuote(query)}:`];
  items.forEach((item, index) => {
    const title = item.title.trim() === "" ? "(no title)" : item.title.trim();
    const link = item.url.trim();
    const snippet = item.description.trim().replaceAll("\n", " ");
    parts.push("");
    parts.push(`${index + 1}. ${title}`);
    if (link !== "") parts.push(`   ${link}`);
    if (snippet !== "") parts.push(`   ${snippet}`);
  });
  return parts.join("\n");
}

function statusLabel(resp: Response): string {
  const text = resp.statusText.trim();
  return text === "" ? String(resp.status) : `${resp.status} ${text}`;
}

function clipBody(body: string): string {
  const s = body.trim();
  if (s === "") return "empty body";
  return s.length > 240 ? s.slice(0, 240) : s;
}

async function readLimited(resp: Response, max: number): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  let step = await reader.read();
  while (!step.done) {
    const value = step.value;
    const room = max - total;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, room));
      total += room;
      try {
        await reader.cancel();
      } catch {
        // The capped prefix is enough.
      }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
    step = await reader.read();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

/** Go `%q` for the query string in the result header. */
function goQuote(s: string): string {
  let out = "\"";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (c === 0x22 || c === 0x5c) out += `\\${ch}`;
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

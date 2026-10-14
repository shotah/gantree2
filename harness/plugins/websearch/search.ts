import { type CallContext, type Tool, type ToolResult, errorResult, textResult } from "@/harness/core/tools";
import {
  BRAVE_DEFAULT_ENDPOINT,
  DEFAULT_COUNT,
  HTTP_TIMEOUT_MS,
  MAX_QUERIES,
  SERPAPI_DEFAULT_ENDPOINT,
  TAVILY_DEFAULT_ENDPOINT,
  type SearchProvider,
  isSearchTool,
  resolveProvider,
  resolveSearchApiKey,
  toolDefs,
} from "./tools";

export type WebSearchDeps = {
  /** Explicit key. Falls back to env resolution. */
  apiKey?: string;
  provider?: SearchProvider;
  env?: Readonly<Record<string, string>>;
  fetch?: typeof fetch;
  /** Tests point this at a fake server for the active provider. */
  endpoint?: string;
};

type SearchHit = { title: string; url: string; description: string };

/**
 * Multi-provider web search client. `open` refuses to publish without a key.
 * An unconfigured client still answers `call` with `websearch: service is not configured`.
 */
export class WebSearch {
  readonly apiKey: string;
  readonly provider: SearchProvider;
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch | null;

  constructor(deps: WebSearchDeps = {}) {
    const env = deps.env ?? {};
    const fromEnv = resolveProvider(env);
    this.provider = deps.provider ?? (fromEnv === "unknown" ? "brave" : fromEnv);
    this.apiKey = (deps.apiKey ?? "").trim() !== "" ? (deps.apiKey ?? "").trim() : resolveSearchApiKey(env);
    const override = (deps.endpoint ?? "").trim();
    if (override !== "") {
      this.endpoint = override;
    } else {
      this.endpoint = defaultEndpoint(this.provider);
    }
    this.fetchFn = deps.fetch ?? null;
  }

  static open(deps: WebSearchDeps = {}): WebSearch {
    const client = new WebSearch(deps);
    if (client.apiKey === "") {
      throw new Error("SEARCH_API_KEY is required for web_search");
    }
    if (client.fetchFn === null) {
      throw new Error("websearch: fetch is required");
    }
    return client;
  }

  /** The `web_search` tool. Failures are `isError` text the model can read. */
  tool(): Tool {
    const def = toolDefs()[0];
    if (!def) {
      throw new Error("websearch: missing tool definition");
    }
    return {
      ...def,
      call: (args, ctx) => this.callTool(args, ctx),
    };
  }

  async call(name: string, args: unknown, signal?: AbortSignal): Promise<string> {
    if (!isSearchTool(name)) {
      throw new Error(`websearch: unknown tool ${goQuote(name)}`);
    }
    if (this.apiKey === "" || this.fetchFn === null) {
      throw new Error("websearch: service is not configured");
    }
    return this.search(readQuery(args), signal);
  }

  async search(query: string, signal?: AbortSignal): Promise<string> {
    const q = query.trim();
    if (q === "") {
      throw new Error("query is required");
    }
    if (this.apiKey === "" || this.fetchFn === null) {
      throw new Error("websearch: service is not configured");
    }
    const fetchFn = this.fetchFn;
    if (!fetchFn) {
      throw new Error("websearch: service is not configured");
    }
    const hits = await this.fetchHits(fetchFn, q, signal);
    return formatResults(q, hits);
  }

  private async fetchHits(fetchFn: typeof fetch, query: string, signal?: AbortSignal): Promise<SearchHit[]> {
    switch (this.provider) {
      case "brave":
        return braveSearch(fetchFn, this.endpoint, this.apiKey, query, signal);
      case "tavily":
        return tavilySearch(fetchFn, this.endpoint, this.apiKey, query, signal);
      case "serpapi":
        return serpapiSearch(fetchFn, this.endpoint, this.apiKey, query, signal);
      default:
        throw new Error(`websearch: unknown provider ${JSON.stringify(this.provider)}`);
    }
  }

  private async callTool(args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> {
    let queries: string[];
    try {
      queries = readQueries(args);
    } catch (err) {
      return errorResult(errorText(err));
    }
    if (queries.length === 0) {
      return errorResult("query is required");
    }
    if (queries.length > MAX_QUERIES) {
      return errorResult(`queries accepts at most ${String(MAX_QUERIES)}`);
    }
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

function defaultEndpoint(provider: SearchProvider): string {
  switch (provider) {
    case "brave":
      return BRAVE_DEFAULT_ENDPOINT;
    case "tavily":
      return TAVILY_DEFAULT_ENDPOINT;
    case "serpapi":
      return SERPAPI_DEFAULT_ENDPOINT;
    default:
      return BRAVE_DEFAULT_ENDPOINT;
  }
}

async function braveSearch(
  fetchFn: typeof fetch,
  endpoint: string,
  apiKey: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (err) {
    throw new Error(`websearch: endpoint: ${errorText(err)}`, { cause: err });
  }
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(DEFAULT_COUNT));
  const resp = await fetchJson(fetchFn, url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
    label: "brave search",
  });
  const message = braveErrorMessage(resp.body);
  if (message !== "") {
    throw new Error(`websearch: brave search failed: ${message}`);
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`websearch: brave search failed (${resp.statusLabel}): ${clipBody(resp.body)}`);
  }
  return readBraveHits(resp.parsed);
}

async function tavilySearch(
  fetchFn: typeof fetch,
  endpoint: string,
  apiKey: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const resp = await fetchJson(fetchFn, endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: DEFAULT_COUNT,
      include_answer: false,
    }),
    signal,
    label: "tavily search",
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`websearch: tavily search failed (${resp.statusLabel}): ${clipBody(resp.body)}`);
  }
  return readTavilyHits(resp.parsed);
}

async function serpapiSearch(
  fetchFn: typeof fetch,
  endpoint: string,
  apiKey: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (err) {
    throw new Error(`websearch: endpoint: ${errorText(err)}`, { cause: err });
  }
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(DEFAULT_COUNT));
  const resp = await fetchJson(fetchFn, url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
    label: "serpapi search",
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`websearch: serpapi search failed (${resp.statusLabel}): ${clipBody(resp.body)}`);
  }
  return readSerpapiHits(resp.parsed);
}

type FetchJsonResult = {
  status: number;
  statusLabel: string;
  body: string;
  parsed: unknown;
};

async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit & { signal?: AbortSignal; label: string },
): Promise<FetchJsonResult> {
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  const combined = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let resp: Response;
  try {
    resp = await fetchFn(url, { ...init, signal: combined });
  } catch (err) {
    throw new Error(`websearch: ${init.label} failed: ${errorText(err)}`, { cause: err });
  }
  const statusLabel = statusLabelOf(resp);
  let body: string;
  try {
    body = await readLimited(resp, 1 << 20);
  } catch (err) {
    throw new Error(`websearch: read body: ${errorText(err)}`, { cause: err });
  }
  const parsed = tryParse(body);
  if (!parsed.ok) {
    throw new Error(`websearch: ${init.label} failed (${statusLabel}): ${clipBody(body)}`);
  }
  return { status: resp.status, statusLabel, body, parsed: parsed.value };
}

function readBraveHits(value: unknown): SearchHit[] {
  if (!isRecord(value)) {
    return [];
  }
  const web = isRecord(value.web) ? value.web : null;
  if (!web || web.results === undefined) {
    return [];
  }
  if (!isUnknownArray(web.results)) {
    throw new Error("websearch: brave search failed: results is not an array");
  }
  const hits: SearchHit[] = [];
  for (const raw of web.results) {
    if (!isRecord(raw)) {
      continue;
    }
    hits.push({
      title: typeof raw.title === "string" ? raw.title : "",
      url: typeof raw.url === "string" ? raw.url : "",
      description: typeof raw.description === "string" ? raw.description : "",
    });
  }
  return hits;
}

function readTavilyHits(value: unknown): SearchHit[] {
  if (!isRecord(value)) {
    return [];
  }
  if (!isUnknownArray(value.results)) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const raw of value.results) {
    if (!isRecord(raw)) {
      continue;
    }
    hits.push({
      title: typeof raw.title === "string" ? raw.title : "",
      url: typeof raw.url === "string" ? raw.url : "",
      description: typeof raw.content === "string" ? raw.content : "",
    });
  }
  return hits;
}

function readSerpapiHits(value: unknown): SearchHit[] {
  if (!isRecord(value)) {
    return [];
  }
  if (!isUnknownArray(value.organic_results)) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const raw of value.organic_results) {
    if (!isRecord(raw)) {
      continue;
    }
    hits.push({
      title: typeof raw.title === "string" ? raw.title : "",
      url: typeof raw.link === "string" ? raw.link : "",
      description: typeof raw.snippet === "string" ? raw.snippet : "",
    });
  }
  return hits;
}

function formatResults(query: string, items: readonly SearchHit[]): string {
  if (items.length === 0) {
    return `No results for ${goQuote(query)}`;
  }
  const parts = [`Search results for ${goQuote(query)}:`];
  items.forEach((item, index) => {
    const title = item.title.trim() === "" ? "(no title)" : item.title.trim();
    const link = item.url.trim();
    const snippet = item.description.trim().replaceAll("\n", " ");
    parts.push("");
    parts.push(`${index + 1}. ${title}`);
    if (link !== "") {
      parts.push(`   ${link}`);
    }
    if (snippet !== "") {
      parts.push(`   ${snippet}`);
    }
  });
  return parts.join("\n");
}

function argumentRecord(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) {
    return {};
  }
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed === "" || trimmed === "null") {
      return {};
    }
    const parsed = tryParse(trimmed);
    if (!parsed.ok) {
      throw new Error(`websearch: bad arguments: ${parsed.error.message}`);
    }
    return argumentRecord(parsed.value);
  }
  if (!isRecord(args)) {
    throw new Error("websearch: bad arguments: expected object");
  }
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
    if (typeof value !== "string") {
      return;
    }
    const query = value.trim();
    if (query === "" || out.includes(query)) {
      return;
    }
    out.push(query);
  };
  if (Array.isArray(record.queries)) {
    for (const item of record.queries) {
      push(item);
    }
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
  if (!isRecord(value)) {
    return "";
  }
  const err = isRecord(value.error) ? value.error : null;
  if (err && typeof err.detail === "string" && err.detail.trim() !== "") {
    return err.detail.trim();
  }
  return typeof value.message === "string" ? value.message.trim() : "";
}

function statusLabelOf(resp: Response): string {
  const text = resp.statusText.trim();
  return text === "" ? String(resp.status) : `${resp.status} ${text}`;
}

function clipBody(body: string): string {
  const s = body.trim();
  if (s === "") {
    return "empty body";
  }
  return s.length > 240 ? s.slice(0, 240) : s;
}

async function readLimited(resp: Response, max: number): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) {
    return "";
  }
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
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "unknown error";
}

/** Go `%q` for the query string in the result header. */
function goQuote(s: string): string {
  let out = "\"";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (c === 0x22 || c === 0x5c) {
      out += `\\${ch}`;
    } else if (c === 0x0a) {
      out += "\\n";
    } else if (c === 0x0d) {
      out += "\\r";
    } else if (c === 0x09) {
      out += "\\t";
    } else if (c < 0x20 || c === 0x7f) {
      out += `\\x${c.toString(16).padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

import type { JsonSchema, Plugin, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, textResult } from "@/brain/core/tools";
import { httpGet, userAgentFrom, validateURL, type Got } from "./http";
import {
  applyLimit,
  firstNonEmpty,
  looksLikeHTML,
  parseFeedDocument,
  parseFeedTitle,
  type FeedDoc,
  type FeedItem,
} from "./parse";

export { keys } from "./keys";

const itemsDescription = "List items from RSS, Atom, or JSON Feed URLs (id, title, url, summary). Use for “what’s new on this feed” and as the watch poller tool. Not a web crawl — needs a feed URL. Discover one with source_resolve. Not X/Twitter. urls accepts up to 8 feeds; url still works for one. One bad feed is an error row.";
const resolveDescription = "Find RSS/Atom/JSON Feed URLs from pages, GitHub repos, NWS zones, or YouTube channels. Use before watch_add when the human named a site, not a feed. Returns candidate URLs — then items_list or watch_add with the pick. Not a general web search. urls accepts up to 8 pages; query still works for one. One miss is an error row.";

const urlRequired = "url is required. Next: items_list(url=\"https://…/rss.xml\")";
const queryRequired = "query is required. Next: source_resolve(query=\"https://…\") or source_resolve(query=\"CAZ513\")";
const noFeed = "no feed found. Try a direct rss.xml / atom.xml URL, a GitHub repo URL, or an NWS zone like CAZ513";

const nwsZoneRe = /\b([A-Z]{2}[ZC]\d{3})\b/;
const githubRepoRe = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i;
const ytChannelRe = /youtube\.com\/channel\/(UC[\w-]+)/i;
const ytChannelIdRe = /"channelId"\s*:\s*"(UC[\w-]+)"/;
const wellKnownPaths = ["/feed", "/rss.xml", "/atom.xml", "/feed.xml", "/rss", "/index.xml"];

export type Candidate = { url: string; title: string; kind: string; source: string };

type FetchFn = (url: string, signal?: AbortSignal) => Promise<Got>;

function goJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[&<>\u2028\u2029]/g, (ch) => {
    switch (ch) {
      case "&": return "\\u0026";
      case "<": return "\\u003c";
      case ">": return "\\u003e";
      case "\u2028": return "\\u2028";
      default: return "\\u2029";
    }
  });
}

const maxFeeds = 8;

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: "object", properties, required };
}

function trimmedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? [] : [text];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const text = item.trim();
    if (text !== "") {
      out.push(text);
    }
  }
  return out;
}

function collect(args: Record<string, unknown>, one: string, many: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...trimmedStrings(args[one]), ...trimmedStrings(args[many])]) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function stringArg(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function intArg(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function itemOut(item: FeedItem): Record<string, string> {
  const out: Record<string, string> = { id: item.id };
  if (item.title) out.title = item.title;
  if (item.url) out.url = item.url;
  if (item.summary) out.summary = item.summary;
  if (item.published) out.published = item.published;
  return out;
}

function feedRecord(doc: FeedDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (doc.title) out.title = doc.title;
  if (doc.url) out.url = doc.url;
  out.items = doc.items.map(itemOut);
  if (doc.notModified) out.not_modified = true;
  if (doc.etag) out.etag = doc.etag;
  if (doc.lastModified) out.last_modified = doc.lastModified;
  return out;
}

function candidateOut(c: Candidate): Record<string, string> {
  const out: Record<string, string> = { url: c.url };
  if (c.title) out.title = c.title;
  if (c.kind) out.kind = c.kind;
  if (c.source) out.source = c.source;
  return out;
}

export function kindFromContentType(ct: string): string {
  if (ct.includes("atom")) return "atom";
  if (ct.includes("rss")) return "rss";
  if (ct.includes("json")) return "json";
  return "feed";
}

export function isFeedType(typ: string): boolean {
  return typ.includes("rss") || typ.includes("atom") || typ.includes("json");
}

export function looksLikeURL(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

export function joinPath(raw: string, path: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (!u.host) return "";
  u.pathname = path;
  u.search = "";
  u.hash = "";
  return u.toString();
}

export function resolveHref(base: string, href: string): string {
  const raw = href.trim();
  if (!raw) return "";
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  return u.toString();
}

export function htmlFeedLinks(body: string, base: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /<link\b([^>]*)>/gi;
  for (const match of body.matchAll(re)) {
    const attrs = parseAttrs(match[1] ?? "");
    const rel = (attrs.rel ?? "").toLowerCase();
    const typ = (attrs.type ?? "").toLowerCase();
    const href = attrs.href ?? "";
    const title = attrs.title ?? "";
    if (!href || !rel.includes("alternate") || !isFeedType(typ)) continue;
    const abs = resolveHref(base, href);
    if (!abs) continue;
    out.push({ url: abs, title, kind: kindFromContentType(typ), source: "link" });
  }
  return out;
}

function isAttrSpace(ch: string): boolean {
  return ch !== "" && /\s/u.test(ch);
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (isAttrSpace(raw[i] ?? "") || raw[i] === "=" || raw[i] === "/")) i += 1;
    if (i >= raw.length) break;
    const keyStart = i;
    while (i < raw.length && !isAttrSpace(raw[i] ?? "") && raw[i] !== "=" && raw[i] !== "/") i += 1;
    const key = raw.slice(keyStart, i).toLowerCase();
    const afterKey = i;
    while (i < raw.length && isAttrSpace(raw[i] ?? "")) i += 1;
    if (raw[i] !== "=") {
      if (key) out[key] = "";
      i = afterKey;
      continue;
    }
    i += 1;
    while (i < raw.length && isAttrSpace(raw[i] ?? "")) i += 1;
    const quote = raw[i] ?? "";
    if (quote === "\"" || quote === "'") {
      i += 1;
      const valStart = i;
      while (i < raw.length && raw[i] !== quote) i += 1;
      if (key) out[key] = raw.slice(valStart, i);
      if (i < raw.length) i += 1;
      continue;
    }
    const valStart = i;
    while (i < raw.length) {
      const c = raw[i] ?? "";
      if (isAttrSpace(c) || c === "\"" || c === "'" || c === "=" || c === "<" || c === ">" || c === "`") break;
      i += 1;
    }
    if (i === valStart) {
      if (key) out[key] = "";
      i = afterKey;
      continue;
    }
    if (key) out[key] = raw.slice(valStart, i);
  }
  return out;
}

export function nwsCandidate(query: string): Candidate | undefined {
  const m = nwsZoneRe.exec(query.toUpperCase());
  const zone = m?.[1];
  if (!zone) return undefined;
  return {
    url: `https://api.weather.gov/alerts/active.atom?zone=${zone}`,
    title: `NWS alerts ${zone}`,
    kind: "atom",
    source: "nws",
  };
}

export function githubCandidate(raw: string): Candidate | undefined {
  const m = githubRepoRe.exec(raw);
  if (!m) return undefined;
  const owner = m[1] ?? "";
  let repo = m[2] ?? "";
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!owner || !repo) return undefined;
  if (owner.toLowerCase() === "orgs" || owner.toLowerCase() === "settings") return undefined;
  return {
    url: `https://github.com/${owner}/${repo}/releases.atom`,
    title: `${owner}/${repo} releases`,
    kind: "atom",
    source: "github",
  };
}

export function youtubeChannelCandidate(raw: string): Candidate | undefined {
  const m = ytChannelRe.exec(raw);
  const id = m?.[1];
  if (!id) return undefined;
  return youtubeCandidate(id);
}

export function youtubeFromHTML(body: string): Candidate | undefined {
  const m = ytChannelIdRe.exec(body);
  const id = m?.[1];
  if (!id) return undefined;
  return youtubeCandidate(id);
}

function youtubeCandidate(id: string): Candidate {
  return {
    url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`,
    title: `YouTube ${id}`,
    kind: "atom",
    source: "youtube",
  };
}

function appendUnique(list: Candidate[], c: Candidate): Candidate[] {
  if (list.some((x) => x.url === c.url)) return list;
  return [...list, c];
}

function prependUnique(list: Candidate[], c: Candidate): Candidate[] {
  if (list.some((x) => x.url === c.url)) return list;
  return [c, ...list];
}

export async function fetchFeed(get: FetchFn, rawURL: string, limit: number, signal?: AbortSignal): Promise<FeedDoc> {
  const url = rawURL.trim();
  const bad = validateURL(url);
  if (bad) throw new Error(bad);
  const got = await get(url, signal);
  if (got.notModified) {
    return {
      title: "",
      url: firstNonEmpty(got.finalURL, url),
      items: [],
      etag: got.etag ?? "",
      lastModified: got.lastModified ?? "",
      notModified: true,
    };
  }
  const text = new TextDecoder().decode(got.body);
  if (looksLikeHTML(text, got.contentType)) {
    throw new Error(`url looks like a web page, not a feed. Next: source_resolve(query=${JSON.stringify(url)})`);
  }
  const doc = parseFeedDocument(text, got.contentType);
  const limited = applyLimit(doc, limit);
  if (!limited.url) limited.url = firstNonEmpty(got.finalURL, url);
  else limited.url = firstNonEmpty(limited.url, got.finalURL, url);
  if (got.etag) limited.etag = got.etag;
  if (got.lastModified) limited.lastModified = got.lastModified;
  return limited;
}

export async function resolveFeed(get: FetchFn, queryRaw: string, signal?: AbortSignal): Promise<{ query: string; candidates: Candidate[] }> {
  const query = queryRaw.trim();
  if (!query) throw new Error("query is required");
  const nws = nwsCandidate(query);
  if (nws) return { query, candidates: [nws] };
  if (!looksLikeURL(query)) return { query, candidates: [] };
  const bad = validateURL(query);
  if (bad) throw new Error(bad);

  let candidates: Candidate[] = [];
  const gh = githubCandidate(query);
  if (gh) candidates = appendUnique(candidates, gh);
  const yt = youtubeChannelCandidate(query);
  if (yt) candidates = appendUnique(candidates, yt);

  let got: Got;
  try {
    got = await get(query, signal);
  } catch (err) {
    if (candidates.length > 0) return { query, candidates };
    throw err;
  }
  const text = new TextDecoder().decode(got.body);
  if (!looksLikeHTML(text, got.contentType)) {
    const title = parseFeedTitle(text);
    if (title !== undefined) {
      candidates = prependUnique(candidates, {
        url: firstNonEmpty(got.finalURL, query),
        title,
        kind: kindFromContentType(got.contentType),
        source: "self",
      });
      return { query, candidates };
    }
  }
  for (const c of htmlFeedLinks(text, got.finalURL || query)) {
    candidates = appendUnique(candidates, c);
  }
  const fromHTML = youtubeFromHTML(text);
  if (fromHTML) candidates = appendUnique(candidates, fromHTML);
  if (candidates.length === 0) {
    for (const path of wellKnownPaths) {
      const probe = joinPath(got.finalURL || query, path);
      if (!probe) continue;
      try {
        const probed = await get(probe, signal);
        const probeText = new TextDecoder().decode(probed.body);
        if (looksLikeHTML(probeText, probed.contentType)) continue;
        const title = parseFeedTitle(probeText);
        if (title === undefined) continue;
        candidates = appendUnique(candidates, {
          url: firstNonEmpty(probed.finalURL, probe),
          title,
          kind: kindFromContentType(probed.contentType),
          source: "well-known",
        });
        break;
      } catch {
        continue;
      }
    }
  }
  return { query, candidates };
}

function fetcher(
  ctx: PluginContext,
  signal?: AbortSignal,
  conditional?: { ifNoneMatch?: string; ifModifiedSince?: string },
): FetchFn {
  const ua = userAgentFrom(ctx.env);
  const ifNoneMatch = conditional?.ifNoneMatch?.trim() ?? "";
  const ifModifiedSince = conditional?.ifModifiedSince?.trim() ?? "";
  return (url, inner) => httpGet({
    fetch: ctx.fetch,
    url,
    userAgent: ua,
    signal: inner ?? signal,
    ifNoneMatch: ifNoneMatch || undefined,
    ifModifiedSince: ifModifiedSince || undefined,
  });
}

async function itemsCall(ctx: PluginContext, signal: AbortSignal | undefined, args: Record<string, unknown>): Promise<ToolResult> {
  const urls = collect(args, "url", "urls");
  if (urls.length === 0) return errorResult(urlRequired);
  if (urls.length > maxFeeds) return errorResult("urls accepts at most 8");
  const limit = intArg(args.limit, 25);
  const conditional = urls.length === 1
    ? { ifNoneMatch: stringArg(args.if_none_match), ifModifiedSince: stringArg(args.if_modified_since) }
    : undefined;
  const get = fetcher(ctx, signal, conditional);
  const rows: Record<string, unknown>[] = [];
  for (const url of urls) {
    try {
      rows.push(feedRecord(await fetchFeed(get, url, limit, signal)));
    } catch (err) {
      rows.push({ url, error: err instanceof Error ? err.message : "not a feed" });
    }
  }
  return textResult(goJSON(rows));
}

async function resolveCall(ctx: PluginContext, signal: AbortSignal | undefined, args: Record<string, unknown>): Promise<ToolResult> {
  const queries = collect(args, "query", "urls");
  if (queries.length === 0) return errorResult(queryRequired);
  if (queries.length > maxFeeds) return errorResult("urls accepts at most 8");
  const get = fetcher(ctx, signal);
  const rows: Record<string, unknown>[] = [];
  for (const query of queries) {
    try {
      const result = await resolveFeed(get, query, signal);
      if (result.candidates.length === 0) {
        rows.push({ query: result.query, error: noFeed });
        continue;
      }
      rows.push({ query: result.query, candidates: result.candidates.map(candidateOut) });
    } catch (err) {
      rows.push({ query, error: err instanceof Error ? err.message : "no feed found" });
    }
  }
  return textResult(goJSON(rows));
}

export const feedsPlugin: Plugin = {
  name: "feeds",
  ready: () => Promise.resolve(null),
  tools(ctx): Tool[] {
    return [
      {
        name: "items_list",
        description: itemsDescription,
        inputSchema: objectSchema({
          url: { type: "string", description: "Feed URL (rss.xml, atom.xml, NWS alerts.atom, GitHub releases.atom)." },
          urls: {
            type: "array",
            description: "Feed URLs to read together (max 8). url still works for one. One bad feed is an error row.",
            items: { type: "string" },
          },
          limit: { type: "number", description: "Max items to return per feed (default 25, max 50)." },
          if_none_match: {
            type: "string",
            description: "ETag from the last poll of this feed. Sends If-None-Match. Omit on a normal read. One url only.",
          },
          if_modified_since: {
            type: "string",
            description: "Last-Modified from the last poll. Sends If-Modified-Since. Omit on a normal read. One url only.",
          },
        }, ["url"]),
        call: (args, call) => itemsCall(ctx, call.signal, args),
      },
      {
        name: "source_resolve",
        description: resolveDescription,
        inputSchema: objectSchema({
          query: { type: "string", description: "Page URL, feed URL, github.com/owner/repo, NWS zone like CAZ513, or YouTube channel URL." },
          urls: {
            type: "array",
            description: "Pages, repos, zones, or channel URLs to resolve together (max 8). query still works for one.",
            items: { type: "string" },
          },
        }, ["query"]),
        call: (args, call) => resolveCall(ctx, call.signal, args),
      },
    ];
  },
};

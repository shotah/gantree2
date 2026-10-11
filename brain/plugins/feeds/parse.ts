import { XMLParser } from "fast-xml-parser";

export const defaultLimit = 25;
export const maxLimit = 50;
const maxSummary = 500;

export type FeedItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  published: string;
};

export type FeedDoc = {
  title: string;
  url: string;
  items: FeedItem[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  stopNodes: ["*.description", "*.summary", "*.content", "*.title", "*.encoded"],
});

export function looksLikeHTML(body: string, ct: string): boolean {
  if (ct.includes("html") && !ct.includes("xml")) return true;
  const head = body.trimStart().slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export function stripTags(s: string): string {
  let out = "";
  let inTag = false;
  for (const ch of s) {
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) out += ch;
  }
  return out.split(/\s+/).filter((part) => part.length > 0).join(" ");
}

export function truncateRunes(s: string, n: number): string {
  if (n < 1) return s;
  const chars = [...s];
  if (chars.length <= n) return s;
  return chars.slice(0, n).join("") + "…";
}

export function firstNonEmpty(...vals: string[]): string {
  for (const v of vals) {
    const t = v.trim();
    if (t) return t;
  }
  return "";
}

export function parseFeedDocument(text: string, contentType: string): FeedDoc {
  if (text.trimStart().startsWith("{") || contentType.includes("json")) {
    const doc = parseJSONFeed(text);
    if (!doc) throw new Error("not a feed: invalid json feed");
    return doc;
  }
  let xml: unknown;
  try {
    xml = parsedUnknown(text);
  } catch (err) {
    throw new Error(`not a feed: ${err instanceof Error ? err.message : "invalid xml"}`, { cause: err });
  }
  const doc = xmlToFeed(xml);
  if (!doc) throw new Error("not a feed: unrecognized document");
  return doc;
}

/** XMLParser.parse is typed `any`; narrow at the boundary. */
function parsedUnknown(xml: string): unknown {
  return parser.parse(xml) as unknown;
}

export function parseFeedTitle(body: string): string | undefined {
  try {
    const doc = parseFeedDocument(body, "");
    const title = doc.title.trim();
    return title || undefined;
  } catch {
    return undefined;
  }
}

function parseJSONFeed(text: string): FeedDoc | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const version = typeof value.version === "string" ? value.version : "";
  if (!version.includes("jsonfeed.org") && !Array.isArray(value.items)) return undefined;
  const items = Array.isArray(value.items) ? value.items : [];
  const out: FeedItem[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const url = str(raw.url);
    const id = firstNonEmpty(str(raw.id), url);
    if (!id) continue;
    const summary = stripTags(firstNonEmpty(str(raw.content_text), str(raw.summary), str(raw.content_html)));
    out.push({
      id,
      title: str(raw.title).trim(),
      url,
      summary: truncateRunes(summary, maxSummary),
      published: timeOf(firstNonEmpty(str(raw.date_published), str(raw.date_modified))),
    });
  }
  return {
    title: str(value.title).trim(),
    url: firstNonEmpty(str(value.feed_url), str(value.home_page_url)),
    items: out,
  };
}

function xmlToFeed(xml: unknown): FeedDoc | undefined {
  if (!isRecord(xml)) return undefined;
  const rss = isRecord(xml.rss) ? xml.rss : undefined;
  const channel = rss && (isRecord(rss.channel) ? rss.channel : undefined);
  if (channel) {
    return {
      title: textOf(channel.title).trim(),
      url: linkOf(channel.link),
      items: asList(channel.item).flatMap((item) => itemFromRecord(item)),
    };
  }
  const feed = isRecord(xml.feed) ? xml.feed : undefined;
  if (feed) {
    return {
      title: textOf(feed.title).trim(),
      url: linkOf(feed.link),
      items: asList(feed.entry).flatMap((item) => itemFromRecord(item)),
    };
  }
  const rdf = isRecord(xml.RDF) ? xml.RDF : isRecord(xml.rdf) ? xml.rdf : undefined;
  if (rdf) {
    const ch = isRecord(rdf.channel) ? rdf.channel : undefined;
    return {
      title: textOf(ch?.title).trim(),
      url: linkOf(ch?.link),
      items: asList(rdf.item).flatMap((item) => itemFromRecord(item)),
    };
  }
  return undefined;
}

function itemFromRecord(raw: unknown): FeedItem[] {
  if (!isRecord(raw)) return [];
  const url = linkOf(raw.link);
  const id = firstNonEmpty(textOf(raw.guid) || textOf(raw.id), url);
  if (!id) return [];
  const summary = stripTags(firstNonEmpty(textOf(raw.description), textOf(raw.summary), textOf(raw.content), textOf(raw.encoded)));
  const publishedRaw = firstNonEmpty(textOf(raw.pubDate), textOf(raw.published), textOf(raw.updated), textOf(raw.date));
  return [{
    id,
    title: stripTags(textOf(raw.title)),
    url,
    summary: truncateRunes(summary, maxSummary),
    published: timeOf(publishedRaw),
  }];
}

function timeOf(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return t;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function textOf(v: unknown): string {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (!isRecord(v)) return "";
  if (typeof v["#text"] === "string") return v["#text"].trim();
  return "";
}

function linkOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      const rel = relOf(item);
      const href = hrefOf(item);
      if (href && (rel === "" || rel === "alternate")) return href;
    }
    for (const item of v) {
      const href = hrefOf(item);
      if (href) return href;
    }
    return "";
  }
  return hrefOf(v) || textOf(v);
}

function hrefOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (!isRecord(v)) return "";
  return typeof v["@_href"] === "string" ? v["@_href"].trim() : "";
}

function relOf(v: unknown): string {
  if (!isRecord(v)) return "";
  return typeof v["@_rel"] === "string" ? v["@_rel"].trim().toLowerCase() : "";
}

function asList(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function clampLimit(limit: number): number {
  if (limit < 1) return defaultLimit;
  if (limit > maxLimit) return maxLimit;
  return limit;
}

export function applyLimit(doc: FeedDoc, limit: number): FeedDoc {
  const n = clampLimit(limit);
  return { ...doc, items: doc.items.slice(0, n) };
}

import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, textResult } from "@/harness/core/tools";
import { errorText, getInt, getString, isRecord, needArg, requireString, requireStringSlice, strField } from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";

const CSE = "https://www.googleapis.com/customsearch/v1";

export const PSE_API_KEY_ENV = "GOOGLE_PSE_API_KEY";
export const PSE_ENGINE_ID_ENV = "GOOGLE_PSE_ENGINE_ID";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function searchTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("pse_search", (args, call) => searchCustom(ctx, args, call)),
    bind("pse_get_engine_info", (_args, call) => engineInfo(ctx, call)),
    bind("pse_search_siterestrict", (args, call) => searchSites(ctx, args, call)),
  ];
}

async function searchCustom(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const q = requireString(args, "q");
  if (q === undefined) {
    return needArg("q", "pse_search(q=\"…\")");
  }
  try {
    return textResult(await executeSearch(ctx, call, q, {
      num: getInt(args, "num", 10),
      start: getInt(args, "start", 1),
      safe: getString(args, "safe", "off"),
      searchType: getString(args, "search_type", ""),
      siteSearch: getString(args, "site_search", ""),
      siteSearchFilter: getString(args, "site_search_filter", ""),
      dateRestrict: getString(args, "date_restrict", ""),
      fileType: getString(args, "file_type", ""),
      lr: getString(args, "language", ""),
      cr: getString(args, "country", ""),
    }));
  } catch (e) {
    return errorResult(errorText(e));
  }
}

async function searchSites(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const q = requireString(args, "q");
  if (q === undefined) {
    return needArg("q", "pse_search_siterestrict(q=\"…\", sites=[…])");
  }
  const sites = requireStringSlice(args, "sites");
  if (!sites) {
    return needArg("sites", "pse_search_siterestrict(q=\"…\", sites=[\"example.com\"])");
  }
  const siteQuery = sites.map((site) => `site:${site}`).join(" OR ");
  try {
    return textResult(await executeSearch(ctx, call, `${q} (${siteQuery})`, {
      num: getInt(args, "num", 10),
      start: getInt(args, "start", 1),
      safe: getString(args, "safe", "off"),
      searchType: "",
      siteSearch: "",
      siteSearchFilter: "",
      dateRestrict: "",
      fileType: "",
      lr: "",
      cr: "",
    }));
  } catch (e) {
    return errorResult(errorText(e));
  }
}

async function engineInfo(ctx: PluginContext, call: CallContext): Promise<ToolResult> {
  let creds: { key: string; cx: string };
  try {
    creds = pseCreds(ctx);
  } catch (e) {
    return errorResult(errorText(e));
  }
  let data: unknown;
  try {
    data = await cse(ctx, call, { key: creds.key, cx: creds.cx, q: "test", num: 1 });
  } catch (e) {
    return errorResult(`querying search engine info: ${errorText(e)}`);
  }
  const context = contextObject(data);
  let title = "Unknown";
  if (context) {
    const t = strField(context, "title");
    if (t !== "") {
      title = t;
    }
  }
  let text = "Search Engine Information:\n";
  text += `- Search Engine ID: ${creds.cx}\n`;
  text += `- Title: ${title}\n`;
  if (context) {
    text += formatSearchFacets(context.facets);
  }
  if (isRecord(data) && isRecord(data.searchInformation)) {
    const total = strField(data.searchInformation, "totalResults") || "Unknown";
    text += "\nSearch Statistics:\n";
    text += `  - Total indexed results: ${total}\n`;
  }
  return textResult(text);
}

type SearchOpts = {
  num: number;
  start: number;
  safe: string;
  searchType: string;
  siteSearch: string;
  siteSearchFilter: string;
  dateRestrict: string;
  fileType: string;
  lr: string;
  cr: string;
};

async function executeSearch(ctx: PluginContext, call: CallContext, q: string, opts: SearchOpts): Promise<string> {
  const { key, cx } = pseCreds(ctx);
  const data = await cse(ctx, call, {
    key,
    cx,
    q,
    num: opts.num,
    start: opts.start,
    safe: opts.safe,
    searchType: opts.searchType || undefined,
    siteSearch: opts.siteSearch || undefined,
    siteSearchFilter: opts.siteSearchFilter || undefined,
    dateRestrict: opts.dateRestrict || undefined,
    fileType: opts.fileType || undefined,
    lr: opts.lr || undefined,
    cr: opts.cr || undefined,
  });
  const info = isRecord(data) ? data.searchInformation : undefined;
  const totalResults = isRecord(info) && typeof info.totalResults === "string" ? info.totalResults : "0";
  const searchTime = isRecord(info) && typeof info.searchTime === "number" ? info.searchTime : 0;
  const items = isRecord(data) && Array.isArray(data.items) ? data.items : [];
  const end = opts.start + items.length - 1;
  let text = "Search Results:\n";
  text += `- Query: "${q}"\n`;
  text += `- Search Engine ID: ${cx}\n`;
  text += `- Total Results: ${totalResults}\n`;
  text += `- Search Time: ${searchTime.toFixed(3)} seconds\n`;
  text += `- Results Returned: ${items.length} (showing ${opts.start} to ${end})\n\n`;
  text += items.length > 0 ? formatCustomSearchResults(items, opts.start) : "\nNo results found.";
  const next = nextStart(data);
  if (next !== undefined) {
    text += `\n\nTo see more results, search again with start=${next}`;
  }
  return text;
}

function pseCreds(ctx: PluginContext): { key: string; cx: string } {
  const key = (ctx.env[PSE_API_KEY_ENV] ?? "").trim();
  if (key === "") {
    throw new Error(`${PSE_API_KEY_ENV} is required`);
  }
  const cx = (ctx.env[PSE_ENGINE_ID_ENV] ?? "").trim();
  if (cx === "") {
    throw new Error(`${PSE_ENGINE_ID_ENV} is required`);
  }
  return { key, cx };
}

async function cse(ctx: PluginContext, call: CallContext, query: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(CSE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") {
      url.searchParams.append(k, String(v));
    }
  }
  let res: Response;
  try {
    res = await ctx.fetch(url.toString(), { signal: call.signal });
  } catch (e) {
    throw new Error(`executing search: ${errorText(e)}`, { cause: e });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`executing search: ${text.trim() || res.status}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`executing search: ${errorText(e)}`, { cause: e });
  }
}

export function formatCustomSearchResults(items: unknown[], start: number): string {
  let text = "Results:\n";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const title = strField(item, "title") || "No title";
    const link = strField(item, "link") || "No link";
    const snippet = (strField(item, "snippet") || "No description available").replaceAll("\n", " ");
    text += `\n${start + i}. ${title}\n   URL: ${link}\n   Snippet: ${snippet}\n`;
    text += formatSearchResultMetadata(isRecord(item) ? item.pagemap : undefined);
  }
  return text;
}

export function formatSearchResultMetadata(raw: unknown): string {
  const pagemap = asRecord(raw);
  if (!pagemap) {
    return "";
  }
  const metatags = pagemap.metatags;
  if (!Array.isArray(metatags) || metatags.length === 0 || !isRecord(metatags[0])) {
    return "";
  }
  const meta = metatags[0];
  let text = "";
  if (typeof meta["og:type"] === "string") {
    text += `   Type: ${meta["og:type"]}\n`;
  }
  const published = meta["article:published_time"];
  if (typeof published === "string" && published.length >= 10) {
    text += `   Published: ${published.slice(0, 10)}\n`;
  }
  return text;
}

export function formatSearchFacets(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "";
  }
  let text = "\nAvailable Refinements:\n";
  for (const facet of raw) {
    if (!Array.isArray(facet)) {
      continue;
    }
    for (const item of facet) {
      if (!isRecord(item)) {
        continue;
      }
      const label = typeof item.label === "string" && item.label !== "" ? item.label : "Unknown";
      const anchor = typeof item.anchor === "string" && item.anchor !== "" ? item.anchor : "Unknown";
      text += `  - ${label} (anchor: ${anchor})\n`;
    }
  }
  return text;
}

function contextObject(data: unknown): Record<string, unknown> | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  return asRecord(data.context);
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  if (isRecord(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function nextStart(data: unknown): number | undefined {
  if (!isRecord(data) || !isRecord(data.queries)) {
    return undefined;
  }
  const next = data.queries.nextPage;
  if (!Array.isArray(next) || !isRecord(next[0])) {
    return undefined;
  }
  const start = next[0].startIndex;
  return typeof start === "number" ? Math.trunc(start) : undefined;
}

import type { JsonSchema, Plugin, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, textResult } from "@/brain/core/tools";
import { clientFromEnv, isAPIError, listTweets, lookupUser, missingTokenError, type XClient } from "./client";

const defaultLimit = 25;
const maxLimit = 50;

const description = "List recent public posts from X/Twitter handles (id, title, url, summary). Use for “watch this account” and “what did @foo post”. Official X API only — pay-per-use; prefer a 30–60m watch interval. Not a scrape, not RSS, not a home timeline. handles accepts up to 8; handle still works for one. One bad handle is an error row.";

const maxHandles = 8;

const handleRequired = "handle is required. Next: posts_list(handle=\"foo\")";

function schema(): JsonSchema {
  return {
    type: "object",
    properties: {
      handle: { type: "string", description: "Public @handle or username (leading @ is stripped)." },
      handles: {
        type: "array",
        description: "Public @handles or usernames (max 8). handle still works for one. Leading @ is stripped.",
        items: { type: "string" },
      },
      limit: { type: "number", description: "Max posts to return per handle (default 25, max 50)." },
    },
    required: ["handle"],
  };
}

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

export function normalizeHandle(handle: string): string {
  let h = handle.trim();
  if (h.startsWith("@")) h = h.slice(1);
  h = h.trim();
  if (!h) throw new Error(handleRequired);
  return h;
}

export function teachIn(err: unknown, handle: string): string {
  if (isAPIError(err)) {
    if (err.status === 401) {
      return "X_BEARER_TOKEN was rejected (HTTP 401). Next: set a valid app-only Bearer from developer.x.com, then posts_list(handle=\"foo\")";
    }
    if (err.status === 404) {
      return `handle ${JSON.stringify(handle)} was not found. Next: posts_list(handle="foo")`;
    }
    if (err.status === 429) {
      return "X API rate limited (HTTP 429). Next: wait, or poll every 30–60m via watch_add";
    }
  }
  return err instanceof Error ? err.message : "request failed";
}

type Item = { id: string; title?: string; url?: string; summary?: string };

export async function listPosts(client: XClient | null, handleRaw: string, limitRaw: number): Promise<{ items: Item[] }> {
  const handle = normalizeHandle(handleRaw);
  let limit = limitRaw;
  if (limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  if (!client) throw missingTokenError();
  const user = await lookupUser(client, handle);
  const tweets = await listTweets(client, user.id, limit);
  const items: Item[] = [];
  for (const tw of tweets) {
    if (!tw.id) continue;
    const url = `https://x.com/${user.username}/status/${tw.id}`;
    const item: Item = { id: tw.id, url };
    if (tw.text) {
      item.title = tw.text;
      item.summary = tw.text;
    }
    items.push(item);
  }
  return { items };
}

function intArg(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function trimmedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? [] : [text];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text !== "") out.push(text);
  }
  return out;
}

function handlesOf(args: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...trimmedStrings(args.handle), ...trimmedStrings(args.handles)]) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function postsCall(env: Readonly<Record<string, string>>, fetchImpl: typeof fetch, signal: AbortSignal | undefined, args: Record<string, unknown>): Promise<ToolResult> {
  const handles = handlesOf(args);
  if (handles.length === 0) return errorResult(handleRequired);
  if (handles.length > maxHandles) return errorResult("handles accepts at most 8");
  let client: XClient;
  try {
    client = clientFromEnv(env, fetchImpl, signal);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : missingTokenError().message);
  }
  const limit = intArg(args.limit, defaultLimit);
  const rows: Record<string, unknown>[] = [];
  for (const handle of handles) {
    try {
      const result = await listPosts(client, handle, limit);
      rows.push({ handle: normalizeHandle(handle), items: result.items });
    } catch (err) {
      rows.push({ handle, error: teachIn(err, handle) });
    }
  }
  return textResult(goJSON(rows));
}

export const twitterPlugin: Plugin = {
  name: "twitter",
  ready: (ctx) => Promise.resolve((ctx.env.X_BEARER_TOKEN ?? "").trim() ? null : "no_key"),
  tools(ctx): Tool[] {
    return [{
      name: "posts_list",
      description,
      inputSchema: schema(),
      call: (args, call) => postsCall(ctx.env, ctx.fetch, call.signal, args),
    }];
  },
};

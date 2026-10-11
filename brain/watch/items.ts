import { MAX_SEEN_IDS } from "./interval";
import { isRecord, isUnknownArray, parseJson } from "./json";
import { goQuote } from "./quote";

/** One fetched entry. `id` is the cursor key. */
export type Item = {
  id: string;
  title: string;
  url: string;
  text: string;
};

const LIST_KEYS = ["items", "entries", "data", "tweets"] as const;

/**
 * Read a fetch-tool result. Accepted shapes:
 *
 * - `{"items":[{"id","title","url"}]}`
 * - `{"entries":[...]}` / `{"data":[...]}` / `{"tweets":[...]}`
 * - `[{"id":"..."}]`
 *
 * Id falls back to guid, then url/link. Items without a stable id are dropped.
 * Empty input returns `null` (a successful poll with nothing to seed).
 */
export function parseItems(raw: string): Item[] | null {
  const text = raw.trim();
  if (text === "") return null;
  const parsed = tryParse(text);
  if (!parsed.ok) {
    if (text.includes("…[truncated]")) {
      throw new Error(`watch: fetch result was truncated mid-JSON: ${parsed.error.message}`);
    }
    throw new Error(`watch: fetch result is not JSON: ${parsed.error.message}`);
  }
  if (isUnknownArray(parsed.value)) return itemsFromArray(parsed.value);
  if (!isRecord(parsed.value)) {
    throw new Error("watch: fetch result is not JSON: expected object or array");
  }
  for (const key of LIST_KEYS) {
    if (!(key in parsed.value)) continue;
    const value = parsed.value[key];
    if (!isUnknownArray(value)) {
      throw new Error(`watch: ${goQuote(key)} is not an array`);
    }
    return itemsFromArray(value);
  }
  throw new Error("watch: no items array in fetch result");
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: parseJson(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error("invalid JSON") };
  }
}

function itemsFromArray(arr: unknown[]): Item[] {
  const out: Item[] = [];
  for (const raw of arr) {
    if (!isRecord(raw)) continue;
    const item: Item = {
      id: firstString(raw, ["id", "guid", "ID"]),
      title: firstString(raw, ["title", "name", "text"]),
      url: firstString(raw, ["url", "link", "href"]),
      text: firstString(raw, ["summary", "content", "body", "description"]),
    };
    if (item.id === "") item.id = item.url;
    if (item.id === "") continue;
    out.push(item);
  }
  return out;
}

function firstString(rec: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const s = stringify(rec[key]);
    if (s !== "") return s;
  }
  return "";
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return formatNumber(v);
  return "";
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n).trim();
}

/** Items whose ids are not in `seen`, in input order. */
export function diffNew(items: readonly Item[], seen: readonly string[]): Item[] {
  const have = new Set(seen);
  const out: Item[] = [];
  for (const item of items) {
    if (have.has(item.id)) continue;
    out.push(item);
  }
  return out;
}

/** Append new ids and keep the last `MAX_SEEN_IDS`. */
export function mergeSeen(seen: readonly string[], items: readonly Item[]): string[] {
  const have = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    if (id === "" || have.has(id)) return;
    have.add(id);
    out.push(id);
  };
  for (const id of seen) add(id);
  for (const item of items) add(item.id);
  if (out.length > MAX_SEEN_IDS) return out.slice(out.length - MAX_SEEN_IDS);
  return out;
}

/** Untrusted payload handed to the agent on a wake. */
export function formatItems(items: readonly Item[]): string {
  return items.map((item) => {
    let line = `- id=${item.id}`;
    if (item.title !== "") line += ` title=${goQuote(item.title)}`;
    if (item.url !== "") line += ` url=${item.url}`;
    if (item.text !== "") line += ` text=${goQuote(truncate(item.text, 240))}`;
    return line;
  }).join("\n");
}

function truncate(s: string, n: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= n) return s;
  let used = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    if (cp === undefined) break;
    const width = utf8Len(cp);
    if (used + width > n) break;
    used += width;
    i += cp > 0xffff ? 2 : 1;
  }
  return `${s.slice(0, i)}…`;
}

function utf8Len(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

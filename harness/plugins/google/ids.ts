import { errorResult, type ToolResult } from "@/harness/core/tools";
import { getString, needArg } from "@/harness/plugins/google/args";

/**
 * Share/edit URL → raw Google id. Mirrors tools/google_id.go.
 * "" when the input looks like a URL but no id can be parsed.
 */
export function extractGoogleResourceID(input: string): string {
  let value = input.trim();
  value = value.replace(/^[<>"']+|[<>"']+$/gu, "");
  if (value === "") {
    return "";
  }
  if (looksLikeGoogleURL(value)) {
    return parseGoogleURLID(value);
  }
  if (looksLikeAnyURL(value)) {
    return "";
  }
  return value;
}

function parseGoogleURLID(input: string): string {
  for (const pattern of ["/file/d/", "/folders/", "/d/"]) {
    const id = cutGooglePathID(input, pattern);
    if (id !== "") {
      return id;
    }
  }
  return idFromGoogleQuery(input);
}

function idFromGoogleQuery(input: string): string {
  try {
    const u = new URL(ensureURLScheme(input));
    const id = u.searchParams.get("id");
    if (id) {
      return id;
    }
  } catch {
    // fall through to a raw id= cut
  }
  const cut = input.indexOf("id=");
  if (cut < 0) {
    return "";
  }
  let after = input.slice(cut + 3);
  const amp = after.search(/[&#]/u);
  if (amp >= 0) {
    after = after.slice(0, amp);
  }
  return after;
}

const GOOGLE_RESOURCE_HOSTS = new Set(["docs.google.com", "drive.google.com", "forms.gle"]);

export function looksLikeGoogleURL(input: string): boolean {
  const trimmed = input.trim().replace(/^[<>"']+|[<>"']+$/gu, "");
  if (trimmed === "") {
    return false;
  }
  try {
    return GOOGLE_RESOURCE_HOSTS.has(new URL(ensureURLScheme(trimmed)).hostname);
  } catch {
    return false;
  }
}

function looksLikeAnyURL(input: string): boolean {
  const lower = input.trim().toLowerCase();
  return lower.startsWith("https://") || lower.startsWith("http://");
}

function ensureURLScheme(input: string): string {
  const lower = input.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return input;
  }
  return `https://${input}`;
}

function cutGooglePathID(input: string, pattern: string): string {
  const exact = input.indexOf(pattern);
  let after: string;
  if (exact >= 0) {
    after = input.slice(exact + pattern.length);
  } else {
    const idx = input.toLowerCase().indexOf(pattern);
    if (idx < 0) {
      return "";
    }
    after = input.slice(idx + pattern.length);
  }
  if (after === "") {
    return "";
  }
  const end = after.search(/[/?#&]/u);
  if (end >= 0) {
    after = after.slice(0, end);
  }
  return after;
}

export type IdFailure = { kind: "missing" } | { kind: "parse"; message: string };

/** requireGoogleID: missing/non-string, or a URL that does not contain an id. */
export function takeGoogleID(args: Record<string, unknown>, key: string): string | IdFailure {
  if (!Object.prototype.hasOwnProperty.call(args, key)) {
    return { kind: "missing" };
  }
  const raw = args[key];
  if (typeof raw !== "string") {
    return { kind: "missing" };
  }
  const id = extractGoogleResourceID(raw);
  if (id === "") {
    return {
      kind: "parse",
      message: `${key}: could not parse a Google id from ${JSON.stringify(raw)} — paste a share/edit URL or raw id`,
    };
  }
  return id;
}

export function googleIDError(failure: IdFailure, key: string, nextCall: string): ToolResult {
  if (failure.kind === "parse") {
    return errorResult(failure.message);
  }
  return needArg(key, nextCall);
}

export function isIdFailure(v: string | IdFailure): v is IdFailure {
  return typeof v !== "string";
}

/** optionalFolderID: share URLs become raw ids; blank stays at the default. */
export function optionalFolderID(args: Record<string, unknown>, defaultVal: string): string {
  const raw = getString(args, "folder_id", defaultVal).trim();
  if (raw === "") {
    return defaultVal;
  }
  const id = extractGoogleResourceID(raw);
  return id === "" ? raw : id;
}

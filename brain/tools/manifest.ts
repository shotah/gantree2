/**
 * Host-manifest drift. Each baked server prints one JSON object for
 * `host-manifest`. The Tools grid trusts that list; `checkManifest`
 * compares it to the tools the registry actually published.
 *
 * Names are the unprefixed tool suffixes (`place_search`), not `maps__place_search`.
 */
import { uniqueSorted } from "./names";
import { type Registry } from "./registry";

export type HostManifest = {
  name: string;
  command: string;
  args: string[];
  /** Tool suffixes. Empty when `hasTools` is false. */
  tools: string[];
  /** False when the JSON omitted `tools` (or set it null). */
  hasTools: boolean;
};

export type ManifestDrift = {
  server: string;
  toolsFieldAbsent: boolean;
  onlyManifest: string[];
  onlyRegistry: string[];
};

/**
 * Parse one host-manifest document. Leading log noise before the first
 * `{` is ignored. `tools` may be `["name"]` or `[{ "name": "name" }]`.
 */
export function parseHostManifest(raw: string): HostManifest {
  const text = jsonPayload(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid json";
    throw new Error(`host-manifest: ${detail}`, { cause: err });
  }
  if (!isRecord(parsed)) {
    throw new Error("host-manifest: expected an object");
  }
  const tools = manifestTools(parsed);
  return {
    name: jsonString(parsed, "name"),
    command: jsonString(parsed, "command"),
    args: jsonStringList(parsed, "args"),
    tools: tools ?? [],
    hasTools: tools !== null,
  };
}

/**
 * Servers whose published suffixes disagree with the manifest, plus any
 * manifest that omitted `tools` (the grid cannot vouch for those).
 * Manifest order is kept.
 */
export function checkManifest(registry: Registry, manifest: readonly HostManifest[]): ManifestDrift[] {
  const out: ManifestDrift[] = [];
  for (const server of manifest) {
    const listed = registry.originalNames(server.name);
    const want = server.hasTools ? server.tools : [];
    const { onlyManifest, onlyRegistry } = diffToolNames(want, listed);
    if (!server.hasTools || onlyManifest.length > 0 || onlyRegistry.length > 0) {
      out.push({
        server: server.name,
        toolsFieldAbsent: !server.hasTools,
        onlyManifest,
        onlyRegistry,
      });
    }
  }
  return out;
}

/** Names present on only one side, sorted. Duplicates on one side count. */
export function diffToolNames(manifest: readonly string[], listed: readonly string[]): { onlyManifest: string[]; onlyRegistry: string[] } {
  const have = new Map<string, number>();
  for (const raw of manifest) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    have.set(name, (have.get(name) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const onlyRegistry: string[] = [];
  for (const raw of listed) {
    const name = raw.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const count = have.get(name) ?? 0;
    if (count === 0) {
      onlyRegistry.push(name);
      continue;
    }
    have.set(name, count - 1);
  }
  const onlyManifest: string[] = [];
  for (const [name, count] of have) {
    for (let n = count; n > 0; n -= 1) {
      onlyManifest.push(name);
    }
  }
  onlyManifest.sort(compare);
  onlyRegistry.sort(compare);
  return { onlyManifest, onlyRegistry };
}

/** The Go drift line, for a grid that still prints it. */
export function formatDrift(server: string, onlyManifest: readonly string[], onlyRegistry: readonly string[], toolsFieldAbsent: boolean): string {
  const lines = [`${server}: drift`];
  if (toolsFieldAbsent) {
    lines.push("host-manifest has no tools field");
  }
  lines.push(`only in host-manifest: ${joinToolNames(onlyManifest)}`);
  lines.push(`only in tools/list: ${joinToolNames(onlyRegistry)}`);
  return lines.join("\n");
}

function joinToolNames(names: readonly string[]): string {
  if (names.length === 0) {
    return "(none)";
  }
  return names.join(", ");
}

function jsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start < 0) {
    throw new Error("host-manifest: expected an object");
  }
  return trimmed.slice(start);
}

function jsonString(obj: Record<string, unknown>, key: string): string {
  if (!Object.hasOwn(obj, key) || obj[key] === null) {
    return "";
  }
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`host-manifest ${key}: expected string`);
  }
  return value;
}

function jsonStringList(obj: Record<string, unknown>, key: string): string[] {
  if (!Object.hasOwn(obj, key) || obj[key] === null) {
    return [];
  }
  const value = obj[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`host-manifest ${key}: expected string array`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
    }
  }
  return out;
}

/** Null when the field is absent or null. */
function manifestTools(obj: Record<string, unknown>): string[] | null {
  if (!Object.hasOwn(obj, "tools") || obj.tools === null) {
    return null;
  }
  const value = obj.tools;
  if (!Array.isArray(value)) {
    throw new Error("host-manifest tools: expected an array");
  }
  if (value.every((item) => typeof item === "string")) {
    const names: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        names.push(item);
      }
    }
    return uniqueSorted(names);
  }
  const names: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error("host-manifest tools: expected an array");
    }
    const name = item.name;
    if (name !== undefined && typeof name !== "string") {
      throw new Error("host-manifest tools: expected an array");
    }
    if (typeof name === "string") {
      names.push(name);
    }
  }
  return uniqueSorted(names);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

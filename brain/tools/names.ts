/**
 * OpenAI-safe tool names. The model sees `{prefix}__{tool}` where prefix is
 * the plugin name (`google`, `google-search`, …) and tool is the name the
 * plugin published. Both sides keep letters, digits, `_`, and `-`; anything
 * else becomes `_`. The joined name must fit OpenAI's 64-character limit.
 *
 * Suffixes stay underscored. Only the prefix is rewritten when a local model
 * turns hyphens into underscores (`google_search__web_search`).
 */

const MAX_TOOL_NAME_LEN = 64;
const SAFE = /[\p{L}\p{Nd}_-]/u;

/** Prefix + tool, sanitized. Throws when either side is empty or the join exceeds 64 UTF-8 bytes. */
export function prefixedName(server: string, tool: string): string {
  const prefix = sanitizeName(server);
  const suffix = sanitizeName(tool);
  if (prefix === "" || suffix === "") {
    throw new Error(`mcp: empty tool name after sanitize (server=${JSON.stringify(server)} tool=${JSON.stringify(tool)})`);
  }
  const name = `${prefix}__${suffix}`;
  if (utf8Length(name) > MAX_TOOL_NAME_LEN) {
    throw new Error(`mcp: tool name ${JSON.stringify(name)} exceeds ${MAX_TOOL_NAME_LEN} chars (OpenAI limit)`);
  }
  return name;
}

export function sanitizeName(raw: string): string {
  const trimmed = raw.trim();
  let out = "";
  for (const char of trimmed) {
    out += SAFE.test(char) ? char : "_";
  }
  return out;
}

/**
 * Rewrite underscores in the server prefix to hyphens.
 * Returns null when there is no `__` or the prefix does not change.
 * The tool suffix is left alone.
 */
export function hyphenatePrefix(toolName: string): string | null {
  const cut = toolName.indexOf("__");
  if (cut < 0) {
    return null;
  }
  const prefix = toolName.slice(0, cut);
  const rest = toolName.slice(cut + 2);
  const alt = prefix.replaceAll("_", "-");
  if (alt === prefix) {
    return null;
  }
  return `${alt}__${rest}`;
}

/** Trim, drop blanks and duplicates, sort by code unit. */
export function uniqueSorted(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  out.sort(compareName);
  return out;
}

export function compareName(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

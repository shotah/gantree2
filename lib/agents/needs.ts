/**
 * Catalog `needs` still missing for the granted servers. A key counts as
 * present when it is in `envKeys` or already listed on the grant's `env`
 * (bare name or `KEY=VALUE`).
 */
import type { Grant, ToolEntry } from "./types";

function forwarded(env: readonly string[] | undefined): Set<string> {
  const keys = new Set<string>();
  for (const entry of env ?? []) {
    const eq = entry.indexOf("=");
    const key = (eq === -1 ? entry : entry.slice(0, eq)).trim();
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

export function missingKeys(
  grants: readonly Grant[],
  envKeys: readonly string[],
  catalog: readonly ToolEntry[],
): { id: string; keys: string[] }[] {
  const have = new Set(envKeys);
  const byId = new Map(catalog.map((tool) => [tool.id, tool]));
  const out: { id: string; keys: string[] }[] = [];
  for (const grant of grants) {
    const tool = byId.get(grant.name);
    if (!tool) {
      continue;
    }
    const viaToml = forwarded(grant.env);
    const keys = tool.needs.filter((key) => !have.has(key) && !viaToml.has(key));
    if (keys.length > 0) {
      out.push({ id: grant.name, keys });
    }
  }
  return out;
}

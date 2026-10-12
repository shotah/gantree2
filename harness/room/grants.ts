/**
 * Settings grants (`config.mcp`) decide which plugins publish. A plugin
 * that is not granted stays in the list so status can say `skipped: disabled`,
 * and its tools are not published.
 */
import type { Plugin, PluginContext, SkipReason } from "@/harness/core/tools";
import { grantsFromToml } from "@/lib/agents/mcpToml";

export function grantedNames(mcp: string): Set<string> {
  const names = new Set<string>();
  for (const grant of grantsFromToml(mcp)) {
    if (grant.name) {
      names.add(grant.name);
    }
  }
  return names;
}

export function grantedPlugins(plugins: readonly Plugin[], mcp: string): Plugin[] {
  const on = grantedNames(mcp);
  return plugins.map((plugin) => (on.has(plugin.name) ? plugin : disabledPlugin(plugin)));
}

function disabledPlugin(plugin: Plugin): Plugin {
  return {
    name: plugin.name,
    ready: (_ctx: PluginContext): Promise<SkipReason | null> => Promise.resolve("disabled"),
    tools: () => [],
  };
}

/**
 * `tools_from` catalogs. The Go eval built the sibling MCP binary and
 * read `tools/list`. Here the catalog is the in-process plugin: names,
 * descriptions, and input schemas from `brain/plugins`, filtered by
 * `fixtures/mcp.toml` when that server has a `tools` allowlist (google
 * publishes only the calendar list and the batch create). Nothing is
 * called. A fixture result for a name the plugin does not publish fails
 * before any model call.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import type { JsonSchema, Plugin, PluginContext } from "@/brain/core/tools";
import { flights } from "@/brain/plugins/flights";
import { toolDef } from "@/brain/plugins/google/catalog";
import { google } from "@/brain/plugins/google";
import { rentals } from "@/brain/plugins/rentals";
import { fixtureDir, type EvalTool } from "./fixture";

export type LiveToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

type ServerSpec = { name: string; tools?: string[] };

const PLUGINS: Record<string, Plugin> = {
  flights,
  google,
  rentals,
};

let cached: LiveToolDef[] | undefined;

/** Parsed `[[server]]` rows. Enough for this file; it is not a TOML library. */
export function parseMcpServers(text: string): ServerSpec[] {
  const servers: ServerSpec[] = [];
  let current: ServerSpec | undefined;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[[server]]")) {
      if (current) {
        servers.push(current);
      }
      current = { name: "" };
      continue;
    }
    if (!current || trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const name = /^name\s*=\s*"([^"]+)"/.exec(trimmed);
    if (name?.[1]) {
      current.name = name[1];
    }
    const tools = /^tools\s*=\s*\[(.*)\]/.exec(trimmed);
    if (tools?.[1]) {
      current.tools = [...tools[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "").filter((item) => item !== "");
    }
  }
  if (current) {
    servers.push(current);
  }
  return servers.filter((server) => server.name !== "");
}

export function loadLiveCatalog(): LiveToolDef[] {
  if (cached) {
    return cached;
  }
  cached = buildLiveCatalog();
  return cached;
}

export function buildLiveCatalog(): LiveToolDef[] {
  const text = readFileSync(join(fixtureDir, "mcp.toml"), "utf8");
  const db = new DatabaseSync(":memory:");
  const ctx = catalogContext(db as unknown as NodeDatabase);
  const defs: LiveToolDef[] = [];
  try {
    for (const spec of parseMcpServers(text)) {
      const plugin = PLUGINS[spec.name];
      if (!plugin) {
        throw new Error(`tools_from ${JSON.stringify(spec.name)} has no in-process plugin`);
      }
      for (const tool of listedTools(plugin, ctx, spec.tools)) {
        defs.push({
          name: qualify(spec.name, tool.name),
          description: tool.description,
          parameters: tool.inputSchema,
        });
      }
    }
    defs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return defs;
  } finally {
    db.close();
  }
}

/**
 * Live defs win. A fixture row supplies the canned result, or `"{}"` when
 * the server publishes a tool the fixture did not mention. A fixture name
 * the live server does not publish is drift. Tools for other servers pass
 * through hand-written.
 */
export function mergeLiveTools(live: readonly LiveToolDef[], servers: readonly string[], fixture: readonly EvalTool[]): EvalTool[] {
  const byName = new Map(fixture.map((tool) => [tool.name, tool]));
  const out: EvalTool[] = [];
  const covered = new Set<string>();
  for (const server of servers) {
    const prefix = `${server}__`;
    let n = 0;
    for (const def of live) {
      if (!def.name.startsWith(prefix)) {
        continue;
      }
      n += 1;
      const canned = byName.get(def.name);
      covered.add(def.name);
      out.push({
        name: def.name,
        description: def.description,
        params: def.parameters,
        result: canned ? canned.result : "{}",
      });
    }
    if (n === 0) {
      throw new Error(`tools_from ${JSON.stringify(server)}: no live tools (server not connected or not in brain/eval/fixtures/mcp.toml)`);
    }
    for (const tool of fixture) {
      if (tool.name.startsWith(prefix) && !covered.has(tool.name)) {
        const have = live.filter((def) => def.name.startsWith(prefix)).map((def) => def.name).sort();
        throw new Error(`fixture tool ${JSON.stringify(tool.name)} is not in the live ${server} catalog (have ${have.join(", ")})`);
      }
    }
  }
  for (const tool of fixture) {
    if (!covered.has(tool.name)) {
      out.push(tool);
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

type Listed = { name: string; description: string; inputSchema: JsonSchema };

function listedTools(plugin: Plugin, ctx: PluginContext, allow: readonly string[] | undefined): Listed[] {
  try {
    const tools = plugin.tools(ctx);
    const filtered = allow && allow.length > 0 ? tools.filter((tool) => allow.includes(tool.name)) : tools;
    if (filtered.length === 0) {
      throw new Error(`tools_from ${JSON.stringify(plugin.name)}: no live tools (server not connected or not in brain/eval/fixtures/mcp.toml)`);
    }
    return filtered.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
  } catch (err) {
    if (plugin.name === "google" && allow && allow.length > 0) {
      return allow.map((name) => toolDef(name));
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`tools_from ${JSON.stringify(plugin.name)}: ${message}`, { cause: err });
  }
}

function qualify(server: string, name: string): string {
  const prefix = `${server}__`;
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

function catalogContext(db: NodeDatabase): PluginContext {
  return {
    env: {
      GOOGLE_TOOL_PRESET: "all",
      RENTCAST_API_KEY: "eval-placeholder",
      SERPAPI_API_KEY: "eval-placeholder",
    },
    sql: nodeSql(db),
    clock: fixedClock(0, "UTC"),
    log: silentLogger,
    fetch: globalThis.fetch,
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  };
}

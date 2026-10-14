import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/harness/core/clock";
import { silentLogger } from "@/harness/core/log";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";
import type { JsonSchema, Plugin, PluginContext, ToolDef } from "@/harness/core/tools";

const pluginsRoot = join(process.cwd(), "harness/plugins");

const singleId = /^(id|url|uri|handle|date|address|zip_code|zip|theme|file|token)$|_id$|_token$/;

function isPlugin(value: unknown): value is Plugin {
  if (typeof value !== "object" || value === null) return false;
  const row = value as { name?: unknown; tools?: unknown; ready?: unknown };
  return typeof row.name === "string" && row.name !== "" && typeof row.tools === "function" && typeof row.ready === "function";
}

function pluralCtx(): PluginContext {
  const env = new Proxy({ GARMIN_TOOL_TIER: "complete", GOOGLE_TOOL_PRESET: "all" }, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key as keyof typeof target];
      return "x";
    },
  });
  return {
    env,
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    clock: fixedClock(Date.parse("2026-10-11T12:00:00Z"), "UTC"),
    log: silentLogger,
    fetch: () => {
      throw new Error("plural checker does not fetch");
    },
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  };
}

function propertiesOf(schema: JsonSchema): Record<string, unknown> {
  const props = schema.properties;
  if (typeof props !== "object" || props === null || Array.isArray(props)) return {};
  return props as Record<string, unknown>;
}

function propType(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : "";
}

function hasArrayProperty(props: Record<string, unknown>): boolean {
  return Object.values(props).some((value) => propType(value) === "array");
}

function hasRangePair(props: Record<string, unknown>): boolean {
  const names = new Set(Object.keys(props));
  const pair = (left: string, right: string) => names.has(left) && names.has(right);
  if (pair("start", "end") || pair("from", "to") || pair("since", "until")) return true;
  if ([...names].some((name) => name === "days" || name.endsWith("_days"))) return true;
  if (names.has("limit") && (names.has("start") || names.has("offset") || names.has("page") || names.has("end"))) return true;
  if (pair("page", "per_page")) return true;
  return false;
}

function hasRequiredSingleId(schema: JsonSchema): boolean {
  const required = schema.required;
  if (!Array.isArray(required)) return false;
  return required.some((name) => typeof name === "string" && singleId.test(name));
}

function acceptsSet(tool: ToolDef): boolean {
  if (typeof tool.single === "string" && tool.single.trim() !== "") return true;
  const props = propertiesOf(tool.inputSchema);
  if (hasArrayProperty(props)) return true;
  if (hasRangePair(props)) return true;
  if (/_(list|search)$/.test(tool.name) && !hasRequiredSingleId(tool.inputSchema)) return true;
  return false;
}

function pluginFolders(): string[] {
  return readdirSync(pluginsRoot).filter((name) => {
    try {
      return statSync(join(pluginsRoot, name, "index.ts")).isFile();
    } catch {
      return false;
    }
  }).sort();
}

async function loadModule(name: string): Promise<unknown> {
  switch (name) {
    case "chat": return import("@/harness/plugins/chat/index.ts");
    case "feeds": return import("@/harness/plugins/feeds/index.ts");
    case "flights": return import("@/harness/plugins/flights/index.ts");
    case "garmin": return import("@/harness/plugins/garmin/index.ts");
    case "google": return import("@/harness/plugins/google/index.ts");
    case "google-health": return import("@/harness/plugins/google-health/index.ts");
    case "image": return import("@/harness/plugins/image/index.ts");
    case "maps": return import("@/harness/plugins/maps/index.ts");
    case "math": return import("@/harness/plugins/math/index.ts");
    case "websearch": return import("@/harness/plugins/websearch/index.ts");
    case "rentals": return import("@/harness/plugins/rentals/index.ts");
    case "strava": return import("@/harness/plugins/strava/index.ts");
    case "twitter": return import("@/harness/plugins/twitter/index.ts");
    default: throw new Error(`no plugin loader for ${name}`);
  }
}

function pluginsIn(loaded: unknown): Plugin[] {
  if (typeof loaded !== "object" || loaded === null) return [];
  const plugins: Plugin[] = [];
  for (const value of Object.values(loaded)) {
    if (isPlugin(value) && !plugins.some((plugin) => plugin.name === value.name && plugin.tools === value.tools)) {
      plugins.push(value);
    }
  }
  return plugins;
}

describe("plugin tools are plural", () => {
  // Imports every plugin. Under the full suite that misses the 5s default.
  it("accepts a set or says why the tool is one item", async () => {
    const ctx = pluralCtx();
    const offenders: string[] = [];
    const folders = pluginFolders();
    expect(folders.length).toBeGreaterThan(0);
    for (const folder of folders) {
      let loaded: unknown;
      try {
        loaded = await loadModule(folder);
      } catch (err) {
        offenders.push(`${folder}: ${err instanceof Error ? err.message : "import failed"}`);
        continue;
      }
      const plugins = pluginsIn(loaded);
      if (plugins.length === 0) {
        offenders.push(`${folder}: no plugin export`);
        continue;
      }
      for (const plugin of plugins) {
        let tools: ToolDef[];
        try {
          tools = plugin.tools(ctx);
        } catch (err) {
          offenders.push(`${plugin.name}: tools() threw ${err instanceof Error ? err.message : "error"}`);
          continue;
        }
        const seen = new Set<string>();
        for (const tool of tools) {
          const id = `${plugin.name}.${tool.name}`;
          if (tool.description.trim() === "") offenders.push(`${id}: empty description`);
          if (seen.has(tool.name)) offenders.push(`${id}: duplicate name`);
          seen.add(tool.name);
          if (!acceptsSet(tool)) offenders.push(id);
        }
      }
    }
    offenders.sort();
    if (offenders.length > 0) {
      expect.fail(`tools that are neither plural nor single:\n${offenders.join("\n")}`);
    }
  }, 20_000);
});

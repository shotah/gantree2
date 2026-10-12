/**
 * Canned plugins. Each fixture tool `server__name` becomes a tool on a
 * plugin named `server`. `call` returns the fixture result every time and
 * tells the {@link Trace} the call actually ran. Results are expanded for
 * `{{+Nm}}` once, at the turn clock the plugins were built with — the same
 * instant the inbound text uses — so a "dinner at {{+90m}}" stub stays put
 * when a second morning moves the clock.
 */
import { textResult, type JsonSchema, type Plugin, type Tool } from "@/harness/core/tools";
import { EVAL_TZ, expandEvalClock, type EvalTool } from "./fixture";
import type { Trace } from "./trace";

export function cannedPlugins(tools: readonly EvalTool[], trace: Trace, nowMs: number, zone = EVAL_TZ): Plugin[] {
  const groups = new Map<string, EvalTool[]>();
  for (const tool of tools) {
    const cut = tool.name.indexOf("__");
    if (cut <= 0) {
      throw new Error(`eval tool ${JSON.stringify(tool.name)} needs a server__name prefix`);
    }
    const server = tool.name.slice(0, cut);
    const list = groups.get(server) ?? [];
    list.push({ ...tool, result: expandEvalClock(tool.result, nowMs, zone) });
    groups.set(server, list);
  }
  const plugins: Plugin[] = [];
  for (const [server, list] of groups) {
    plugins.push(cannedPlugin(server, list, trace));
  }
  return plugins;
}

function cannedPlugin(server: string, tools: readonly EvalTool[], trace: Trace): Plugin {
  const defs: Tool[] = tools.map((tool) => {
    const suffix = tool.name.slice(server.length + 2);
    const schema: JsonSchema = tool.params ?? { type: "object", properties: {} };
    return {
      name: suffix,
      description: tool.description,
      inputSchema: schema,
      call: (args) => {
        trace.confirmPlugin(tool.name, args, tool.result);
        return Promise.resolve(textResult(tool.result));
      },
    };
  });
  return {
    name: server,
    ready: () => Promise.resolve(null),
    tools: () => defs,
  };
}

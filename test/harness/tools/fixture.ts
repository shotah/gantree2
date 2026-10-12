import { DatabaseSync } from "node:sqlite";
import { fixedClock, type Clock } from "@/harness/core/clock";
import { makeLogger, memorySink, type LogSink } from "@/harness/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/harness/core/sql";
import { textResult, type CallContext, type Plugin, type PluginContext, type SkipReason, type Tool, type ToolResult } from "@/harness/core/tools";

export const T0 = Date.UTC(2026, 7, 17, 12, 0, 0);

export function memSql(): Sql {
  // DatabaseSync bindings are narrower than SqlValue; the runtime accepts them.
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

export function testClock(at = T0): ReturnType<typeof fixedClock> {
  return fixedClock(at);
}

export function testContext(sql: Sql, clock: Clock, sink: LogSink = memorySink()): PluginContext {
  return {
    env: {},
    sql,
    clock,
    log: makeLogger(sink, () => clock.now()),
    fetch: globalThis.fetch.bind(globalThis),
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  };
}

export function callCtx(over: Partial<CallContext> = {}): CallContext {
  return { userId: "u", sessionId: "s", ...over };
}

export function textOf(result: ToolResult): string {
  const part = result.content[0];
  if (!part || part.type !== "text") {
    return "";
  }
  return part.text;
}

export function echoTool(name: string, description = name): Tool {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
    call: (args) => Promise.resolve(textResult(`${name}:${JSON.stringify(args)}`)),
  };
}

export function fakePlugin(
  name: string,
  tools: readonly Tool[],
  ready: SkipReason | null | ((ctx: PluginContext) => Promise<SkipReason | null>) = null,
): Plugin {
  return {
    name,
    ready: (ctx) => (typeof ready === "function" ? ready(ctx) : Promise.resolve(ready)),
    tools: () => [...tools],
  };
}

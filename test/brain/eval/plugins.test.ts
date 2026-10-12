import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { atLocalTime, fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import { type ChatProvider, type ChatResult } from "@/brain/core/provider";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { type CallContext, type PluginContext } from "@/brain/core/tools";
import { mergeLiveTools, type LiveToolDef } from "@/brain/eval/catalog";
import { EVAL_TZ } from "@/brain/eval/fixture";
import { cannedPlugins } from "@/brain/eval/plugins";
import { Trace } from "@/brain/eval/trace";

const live: LiveToolDef[] = [
  {
    name: "rentals__listings_search",
    description: "THRIFTY: one call",
    parameters: { type: "object", properties: { neighborhood: { type: "string" } } },
  },
  { name: "rentals__account_get", description: "FREE counter", parameters: { type: "object" } },
  { name: "flights__offers_search", description: "not asked for", parameters: { type: "object" } },
];

function pluginCtx(): PluginContext {
  const db = new DatabaseSync(":memory:");
  return {
    env: {},
    sql: nodeSql(db as unknown as NodeDatabase),
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

const callCtx: CallContext = { userId: "eval", sessionId: "agent" };

describe("eval plugins", () => {
  it("merges live defs with canned results and rejects a renamed tool", () => {
    const got = mergeLiveTools(live, ["rentals"], [
      { name: "rentals__listings_search", description: "", result: `{"count":1}` },
      { name: "google__calendar_list_events", description: "hand-written", result: "[]" },
    ]);
    expect(got.map((tool) => tool.name)).toEqual([
      "google__calendar_list_events",
      "rentals__account_get",
      "rentals__listings_search",
    ]);
    const search = got.find((tool) => tool.name === "rentals__listings_search");
    expect(search?.description).toBe("THRIFTY: one call");
    expect(search?.result).toBe(`{"count":1}`);
    expect(got.find((tool) => tool.name === "rentals__account_get")?.result).toBe("{}");
    expect(got.find((tool) => tool.name === "google__calendar_list_events")?.description).toBe("hand-written");

    expect(() => mergeLiveTools(live, ["rentals"], [{ name: "rentals__search", description: "", result: "[]" }])).toThrow(
      /"rentals__search" is not in the live rentals catalog/,
    );
    expect(() => mergeLiveTools(live, ["garmin"], [])).toThrow(/no live tools/);
  });

  it("returns the expanded canned result and records the call", async () => {
    const noon = atLocalTime(Date.parse("2026-09-14T19:00:00Z"), EVAL_TZ, 12, 0);
    const trace = new Trace();
    const mark = trace.mark();
    const plugins = cannedPlugins([
      {
        name: "google__calendar_list_events",
        description: "list",
        result: `[{"summary":"Dinner","start":"{{+90m}}"}]`,
      },
    ], trace, noon, EVAL_TZ);
    const plugin = plugins[0];
    expect(plugin).toBeDefined();
    const tool = plugin?.tools(pluginCtx())[0];
    expect(tool).toBeDefined();
    const result = await tool?.call({}, callCtx);
    expect(result?.content).toEqual([{ type: "text", text: `[{"summary":"Dinner","start":"1:30PM"}]` }]);
    const slice = trace.since(mark);
    expect(slice.calls).toEqual([
      {
        name: "google__calendar_list_events",
        args: "{}",
        round: 1,
        result: `[{"summary":"Dinner","start":"1:30PM"}]`,
      },
    ]);
  });

  it("counts a builtin the model requested and drops a plugin call that never ran", async () => {
    const trace = new Trace();
    const mark = trace.mark();
    const once = async (): Promise<ChatResult> => ({
      content: "",
      toolCalls: [
        { id: "e", name: "mcp_enable", arguments: `{"prefixes":["google"]}` },
        { id: "g", name: "google__calendar_list_events", arguments: "{}" },
      ],
      usage: { prompt: 10, completion: 2 },
    });
    const inner: ChatProvider = {
      complete: once,
      completeStream: (_req, _onProgress) => once(),
    };
    await trace.wrap(inner).complete({ messages: [] });
    const blocked = trace.since(mark);
    expect(blocked.calls.map((call) => call.name)).toEqual(["mcp_enable"]);
    expect(blocked.rounds).toBe(1);
    expect(blocked.prompt).toBe(10);

    const again = new Trace();
    const start = again.mark();
    let step = 0;
    const complete = (): Promise<ChatResult> => {
      step += 1;
      return Promise.resolve({
        content: "",
        toolCalls: [{ id: `g${String(step)}`, name: "google__calendar_list_events", arguments: "{}" }],
        usage: { prompt: 1, completion: 1 },
      });
    };
    const inner2: ChatProvider = {
      complete,
      completeStream: (_req, _onProgress) => complete(),
    };
    const wrapped = again.wrap(inner2);
    await wrapped.complete({ messages: [] });
    await wrapped.complete({ messages: [] });
    again.confirmPlugin("google__calendar_list_events", {}, "[]");
    const ran = again.since(start);
    expect(ran.calls).toEqual([
      { name: "google__calendar_list_events", args: "{}", round: 2, result: "[]" },
    ]);
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { type CallContext, type Tool } from "@/brain/core/tools";
import {
  TOOL_ADD,
  TOOL_CANCEL,
  TOOL_LIST,
  WatchStore,
  callWatchTool,
  isWatchTool,
  toolDefs,
  watchTools,
} from "@/brain/watch";

const AT = Date.UTC(2026, 0, 1);

function open(max = 5) {
  const clock = fixedClock(AT);
  const store = new WatchStore(
    nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    clock,
    max,
    makeLogger(memorySink(), () => clock.now()),
  );
  return { clock, store };
}

function ctx(sessionId: string, userId = ""): CallContext {
  return { userId, sessionId };
}

async function invoke(tools: Tool[], name: string, args: Record<string, unknown>, context: CallContext): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.call(args, context);
  const part = result.content[0];
  const text = part?.type === "text" ? part.text : "";
  if (result.isError) throw new Error(text);
  return text;
}

describe("watch tools", () => {
  it("publishes watch_add, watch_list, and watch_cancel", () => {
    const defs = toolDefs();
    expect(defs.map((def) => def.name)).toEqual([TOOL_ADD, TOOL_LIST, TOOL_CANCEL]);
    for (const name of [TOOL_ADD, TOOL_LIST, TOOL_CANCEL]) {
      expect(isWatchTool(name)).toBe(true);
    }
    expect(isWatchTool("nope")).toBe(false);
    expect(defs[0]?.description).toContain("feeds__items_list");
  });

  it("adds, lists, and cancels", async () => {
    const { store } = open();
    const tools = watchTools(store);
    const context = ctx("stdio", "local");
    const added = await invoke(tools, TOOL_ADD, {
      tool: "feeds__items_list",
      args: { url: "https://x" },
      interval: "15m",
      label: "blog",
    }, context);
    expect(added).toContain("watching id=");
    expect(added).toContain("interval=15m0s");
    expect(added).toContain("label=\"blog\"");

    const listed = await invoke(tools, TOOL_LIST, {}, context);
    expect(listed).not.toBe("no active watches");
    expect(listed).toContain("feeds__items_list");

    const watches = store.listSession("stdio", false);
    expect(watches).toHaveLength(1);
    const id = watches[0]?.id;
    if (id === undefined) throw new Error("missing watch");
    await invoke(tools, TOOL_CANCEL, { id: String(id) }, context);
    expect(await invoke(tools, TOOL_LIST, {}, context)).toBe("no active watches");
  });

  it("requires a session and a prefixed tool", async () => {
    const { store } = open();
    const tools = watchTools(store);
    await expect(invoke(tools, TOOL_ADD, { tool: "feeds__items_list" }, ctx(""))).rejects.toThrow(/missing delivery/);
    await expect(invoke(tools, TOOL_ADD, { tool: "memory_store" }, ctx("s"))).rejects.toThrow(/prefixed MCP name/);
    expect(() => callWatchTool(store, "nope", {}, ctx("s"))).toThrow(/unknown tool/);
    expect(() => callWatchTool(store, TOOL_ADD, "{", ctx("s"))).toThrow(/bad arguments/);
  });

  it("fails closed without a store and cancels by id from any session", async () => {
    expect(() => callWatchTool(null, TOOL_LIST, null, ctx("s"))).toThrow(/store not configured/);
    const { store } = open();
    const tools = watchTools(store);
    const added = await invoke(tools, TOOL_ADD, { tool: "feeds__items_list" }, ctx("s"));
    expect(added).not.toBe("");
    await invoke(tools, TOOL_CANCEL, { id: 1 }, ctx("other"));
    expect(store.listSession("", false)).toEqual([]);
    await expect(invoke(tools, TOOL_CANCEL, { id: true }, ctx("s"))).rejects.toThrow(/invalid id/);
  });

  it("raises a short interval to the server floor", async () => {
    const { store } = open();
    const tools = watchTools(store, (tool) => (tool.startsWith("rentals__") ? 24 * 60 * 60 : 0));
    const context = ctx("s", "u");
    const raised = await invoke(tools, TOOL_ADD, {
      tool: "rentals__listings_search",
      args: { city: "Denver" },
      label: "denver rentals",
    }, context);
    expect(raised).toContain("interval=24h0m0s");
    expect(raised).toContain("interval raised to 24h0m0s");
    const watches = store.listSession("s", false);
    expect(watches).toHaveLength(1);
    expect(watches[0]?.intervalSeconds).toBe(24 * 60 * 60);

    const plain = await invoke(tools, TOOL_ADD, { tool: "feeds__items_list", interval: "15m" }, context);
    expect(plain).toContain("interval=15m0s");
    expect(plain).not.toContain("raised");
  });
});

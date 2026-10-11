import { describe, expect, it } from "vitest";
import { type CallContext } from "@/brain/core/tools";
import {
  callMemoryTool,
  isMemoryTool,
  KIND_FACT,
  KIND_INSIGHT,
  memoryToolDefs,
  memoryTools,
  SUBJECT_AIM_BOOTSTRAP,
  TOOL_FORGET,
  TOOL_RECALL,
  TOOL_STORE,
} from "@/brain/memory";
import { openMemory } from "./fixture";

const ctx: CallContext = { userId: "u", sessionId: "s" };

describe("tools", () => {
  it("round-trips store, recall, and forget", async () => {
    const { store } = openMemory();
    const stored = await callMemoryTool(store, TOOL_STORE, { kind: "fact", subject: "x", content: "y" });
    expect(stored).not.toBe("");
    const recalled = await callMemoryTool(store, TOOL_RECALL, { query: "y" });
    expect(recalled).not.toBe("no memories matched");
    const forgot = await callMemoryTool(store, TOOL_FORGET, { query: "y" });
    expect(forgot).not.toBe("");
  });

  it("forgets a string id", async () => {
    const { store } = openMemory();
    const e = store.store(KIND_FACT, "s", "c");
    const out = await callMemoryTool(store, TOOL_FORGET, { id: String(e.id) });
    expect(out).not.toBe("");
    expect(() => store.get(e.id)).toThrow(/not found/);
  });

  it("cascades an aim area and skips bootstrap", async () => {
    const { store } = openMemory();
    const e = store.store(KIND_INSIGHT, "aim/training", "3x gym");
    store.store(KIND_FACT, SUBJECT_AIM_BOOTSTRAP, "asked");
    const forgot: string[] = [];
    await callMemoryTool(store, TOOL_FORGET, { id: e.id }, (area) => {
      forgot.push(area);
    });
    expect(forgot).toEqual(["training"]);

    store.store(KIND_FACT, SUBJECT_AIM_BOOTSTRAP, "asked again");
    const boot = store.activeByKindSubject(KIND_FACT, SUBJECT_AIM_BOOTSTRAP);
    expect(boot).not.toBeNull();
    forgot.length = 0;
    await callMemoryTool(store, TOOL_FORGET, { id: boot?.id ?? 0 }, (area) => {
      forgot.push(area);
    });
    expect(forgot).toEqual([]);
  });

  it("publishes the three memory tools", async () => {
    expect(isMemoryTool(TOOL_STORE)).toBe(true);
    expect(isMemoryTool("x")).toBe(false);
    expect(memoryToolDefs()).toHaveLength(3);
    const { store } = openMemory();
    const tools = memoryTools(store);
    const storeTool = tools.find((t) => t.name === TOOL_STORE);
    expect(storeTool).toBeDefined();
    const ok = await storeTool?.call({ kind: "fact", subject: "s", content: "c" }, ctx);
    expect(ok?.isError).toBeUndefined();
    expect(ok?.content[0]).toMatchObject({ type: "text" });
    const bad = await storeTool?.call({ kind: "nope", subject: "s", content: "c" }, ctx);
    expect(bad?.isError).toBe(true);
    await expect(callMemoryTool(null, TOOL_STORE, {})).rejects.toThrow(/not configured/);
    await expect(callMemoryTool(store, "nope", {})).rejects.toThrow(/unknown tool/);
  });
});

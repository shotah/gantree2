import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { textResult } from "@/brain/core/tools";
import {
  AGENT_SESSION,
  WAKE_PREFIX,
  WatchStore,
  type CallTool,
  type OnNewItems,
  type WatchWake,
} from "@/brain/watch";

const AT = Date.UTC(2026, 0, 1);

function memoryDb() {
  // DatabaseSync bindings are narrower than SqlValue; the runtime accepts them.
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

function open(max = 10) {
  const sql = memoryDb();
  const clock = fixedClock(AT);
  const sink = memorySink();
  const store = new WatchStore(sql, clock, max, makeLogger(sink, () => clock.now()));
  return { sql, clock, sink, store };
}

function scripted(results: string[], errors: Array<Error | null> = []) {
  const calls = { n: 0 };
  const callTool: CallTool = async () => {
    const index = calls.n;
    calls.n += 1;
    const err = errors[index];
    if (err) throw err;
    const raw = results[index] ?? results[results.length - 1] ?? "{\"items\":[]}";
    return textResult(raw);
  };
  return { callTool, calls };
}

function wakesOf(): { onNewItems: OnNewItems; wakes: WatchWake[] } {
  const wakes: WatchWake[] = [];
  const onNewItems: OnNewItems = async (wake) => {
    wakes.push(wake);
  };
  return { onNewItems, wakes };
}

function prime(store: WatchStore, id: number, seen: string[]) {
  const watch = store.get(id);
  expect(store.claim(id, store.clock.now())).toBe(true);
  store.finish(watch, seen, null);
  store.forceDueForTest(id);
}

describe("pollDue", () => {
  it("seeds the cursor on the first poll and does not wake", async () => {
    const { store, clock } = open();
    const fetchTool = scripted([`{"items":[{"id":"old1"},{"id":"old2"}]}`]);
    const { onNewItems, wakes } = wakesOf();
    store.add("feeds__items_list", { url: "https://x" }, "blog", 60, { sessionId: "s", userId: "u", chatId: "c" });
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toEqual([]);
    expect(fetchTool.calls.n).toBe(1);
    const list = store.listSession("s", false);
    expect(list).toHaveLength(1);
    expect(list[0]?.seenIds).toEqual(["old1", "old2"]);
    expect(store.nextDue()).toBe(clock.now() + 60_000);
  });

  it("wakes only for ids that were not in the cursor", async () => {
    const { store, clock } = open();
    const fetchTool = scripted([`{"items":[{"id":"a"},{"id":"b","title":"fresh"}]}`]);
    const { onNewItems, wakes } = wakesOf();
    const watch = store.add("feeds__items_list", {}, "blog", 60, { sessionId: "s", userId: "u", chatId: "c" });
    prime(store, watch.id, ["a"]);
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toHaveLength(1);
    const text = wakes[0]?.text ?? "";
    expect(text.startsWith(WAKE_PREFIX)).toBe(true);
    expect(text).toContain("id=b");
    expect(text).toContain("fresh");
    expect(text).toContain("do not re-fetch");
    expect(text).toContain("label: blog");
    expect(text).not.toContain("- id=a");
  });

  it("records a fetch error and does not wake", async () => {
    const { store, clock } = open();
    const fetchTool = scripted([], [new Error("context deadline exceeded")]);
    const { onNewItems, wakes } = wakesOf();
    const watch = store.add("feeds__items_list", {}, "", 60, { sessionId: "s" });
    prime(store, watch.id, ["seed"]);
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toEqual([]);
    const got = store.get(watch.id);
    expect(got.lastError).toContain("context deadline exceeded");
    expect(got.seenIds).toEqual(["seed"]);
    expect(got.running).toBe(false);
  });

  it("stays quiet when every id was already seen", async () => {
    const { store, clock } = open();
    const fetchTool = scripted([`{"items":[{"id":"a"}]}`]);
    const { onNewItems, wakes } = wakesOf();
    const watch = store.add("feeds__items_list", {}, "", 60, { sessionId: "s" });
    prime(store, watch.id, ["a"]);
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toEqual([]);
    expect(store.get(watch.id).seenIds).toEqual(["a"]);
  });

  it("records a parse error and does not wake", async () => {
    const { store, clock } = open();
    const fetchTool = scripted(["not-json"]);
    const { onNewItems, wakes } = wakesOf();
    const watch = store.add("feeds__items_list", {}, "", 60, { sessionId: "s" });
    prime(store, watch.id, ["seed"]);
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toEqual([]);
    const got = store.get(watch.id);
    expect(got.lastError).toContain("not JSON");
    expect(got.seenIds).toEqual(["seed"]);
  });

  it("keeps the merged cursor when the turn fails", async () => {
    const { store, clock } = open();
    const fetchTool = scripted([`{"items":[{"id":"n"}]}`]);
    const watch = store.add("feeds__items_list", {}, "lab", 60, { sessionId: "s", userId: "u" });
    prime(store, watch.id, ["old"]);
    const onNewItems: OnNewItems = async () => {
      throw new Error("context canceled");
    };
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    const got = store.get(watch.id);
    expect(got.lastError).toContain("context canceled");
    expect(got.seenIds).toEqual(["old", "n"]);
    expect(got.enabled).toBe(true);
  });

  it("parks a refused poll until retryAfter and keeps the cursor", async () => {
    const { store, clock } = open();
    const reset = clock.now() + 9 * 60 * 60 * 1000;
    const fetchTool = scripted([]);
    const callTool: CallTool = async () => {
      fetchTool.calls.n += 1;
      return {
        content: [{ type: "text", text: "mcp: rentals budget 1/day used" }],
        isError: true,
        retryAfter: reset,
      };
    };
    const onNewItems: OnNewItems = async () => {
      throw new Error("handle must not run on a refused poll");
    };
    const watch = store.add("rentals__listings_search", {}, "denver", 15 * 60, { sessionId: "s", userId: "u", chatId: "c" });
    prime(store, watch.id, ["seen1"]);
    await store.pollDue(clock.now(), callTool, onNewItems);
    const got = store.listSession("s", false)[0];
    expect(got?.enabled).toBe(true);
    expect(got?.seenIds).toEqual(["seen1"]);
    expect(got?.nextPollAt).toBe(reset);
    expect(got?.lastError).toContain("budget");
    expect(fetchTool.calls.n).toBe(1);
  });

  it("reschedules a plain error on the watch interval", async () => {
    const { store, clock } = open();
    const fetchTool = scripted([], [new Error("boom")]);
    const watch = store.add("feeds__items_list", {}, "", 15 * 60, { sessionId: "s", userId: "u", chatId: "c" });
    store.forceDueForTest(watch.id);
    const now = clock.now();
    await store.pollDue(now, fetchTool.callTool, async () => {
      throw new Error("plain fetch error must not wake");
    });
    const got = store.listSession("s", false)[0];
    expect(got?.nextPollAt).toBe(now + 15 * 60 * 1000);
    expect(got?.lastError).toContain("boom");
  });

  it("keeps a feed wake after mouth sessions collapse to the agent session", async () => {
    const { sql, clock, store } = open();
    const watch = store.add("feeds__items_list", { url: "https://x" }, "blog", 60, {
      sessionId: "telegram:99:42",
      userId: "42",
      chatId: "99",
    });
    prime(store, watch.id, ["a"]);
    const reopened = new WatchStore(sql, clock, 10);
    const got = reopened.get(watch.id);
    expect(got.enabled).toBe(true);
    expect(got.tool).toBe("feeds__items_list");
    expect(got.sessionId).toBe(AGENT_SESSION);
    reopened.forceDueForTest(watch.id);
    const { onNewItems, wakes } = wakesOf();
    const fetchTool = scripted([`{"items":[{"id":"a"},{"id":"b","title":"fresh"}]}`]);
    await reopened.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.text).toContain("id=b");
    expect(wakes[0]?.sessionId).toBe(AGENT_SESSION);
    expect(wakes[0]?.userId).toBe("");
  });

  it("polls a watch left running by a crash", async () => {
    const { sql, clock, store } = open();
    const watch = store.add("feeds__items_list", {}, "", 60, { sessionId: "s" });
    sql.exec("UPDATE watch SET running = 1 WHERE id = ?", watch.id);
    const fetchTool = scripted([`{"items":[{"id":"a"}]}`]);
    const { onNewItems, wakes } = wakesOf();
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toEqual([]);
    expect(fetchTool.calls.n).toBe(1);
    expect(store.get(watch.id).seenIds).toEqual(["a"]);
    expect(store.get(watch.id).running).toBe(false);
  });
});

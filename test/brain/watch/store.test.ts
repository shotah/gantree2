import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink } from "@/brain/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import { WatchStore, type WatchDelivery } from "@/brain/watch";

const AT = Date.UTC(2026, 0, 1);

function memoryDb(): Sql {
  // DatabaseSync bindings are narrower than SqlValue; the runtime accepts them.
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

function open(max = 50) {
  const sql = memoryDb();
  const clock = fixedClock(AT);
  const log = makeLogger(memorySink(), () => clock.now());
  const store = new WatchStore(sql, clock, max, log);
  return { sql, clock, store };
}

function delivery(sessionId: string, userId = "", chatId = ""): WatchDelivery {
  return { sessionId, userId, chatId };
}

describe("WatchStore", () => {
  it("adds, claims, finishes, and cancels", () => {
    const { sql, clock, store } = open(5);
    expect(store.maxWatches).toBe(5);
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration ORDER BY id").map((row) => row.id))
      .toEqual(["watch.001", "watch.002", "watch.003"]);

    const watch = store.add("feeds__items_list", { url: "https://x" }, "nws", 15 * 60, delivery("s1", "u", "c"));
    expect(watch.id).not.toBe(0);
    expect(watch.tool).toBe("feeds__items_list");
    expect(watch.label).toBe("nws");
    expect(watch.userId).toBe("");
    expect(watch.chatId).toBe("");
    expect(watch.nextPollAt).toBe(clock.now());

    const due = store.due(clock.now() + 1000, 10);
    expect(due.map((row) => row.id)).toEqual([watch.id]);

    expect(store.claim(watch.id, clock.now())).toBe(true);
    expect(store.claim(watch.id, clock.now())).toBe(false);
    store.finish(watch, ["a", "b"], null);

    const got = store.get(watch.id);
    expect(got.running).toBe(false);
    expect(got.seenIds).toEqual(["a", "b"]);
    expect(got.nextPollAt).toBeGreaterThan(clock.now());

    store.cancel(watch.id);
    expect(store.get(watch.id).enabled).toBe(false);
    expect(() => store.cancel(999)).toThrow(/not found/);
  });

  it("rejects an unprefixed tool, a missing session, and a full cap", () => {
    const { store } = open(1);
    const d = delivery("s");
    expect(() => store.add("memory_store", null, "", 60, d)).toThrow(/prefixed MCP name/);
    expect(() => store.add("feeds__items_list", null, "", 60, delivery(""))).toThrow(/session_id is required/);
    store.add("feeds__items_list", null, "", 60, d);
    expect(() => store.add("feeds__other", null, "", 60, d)).toThrow(/max active watches \(1\)/);
  });

  it("clears a stuck running flag so the watch is due again", () => {
    const { sql, clock, store } = open(5);
    const watch = store.add("feeds__items_list", null, "", 60, delivery("s"));
    sql.exec("UPDATE watch SET running = 1 WHERE id = ?", watch.id);
    expect(store.due(clock.now(), 10)).toEqual([]);
    expect(store.clearStaleRunning()).toBe(1);
    expect(store.due(clock.now(), 10)).toHaveLength(1);
  });

  it("does not resurrect a watch cancelled while it was claimed", () => {
    const { clock, store } = open(5);
    const watch = store.add("feeds__items_list", null, "", 60, delivery("s"));
    expect(store.claim(watch.id, clock.now())).toBe(true);
    store.cancel(watch.id);
    store.finish(watch, ["x"], null);
    expect(store.get(watch.id).enabled).toBe(false);
  });

  it("rejects a nil database", () => {
    expect(() => new WatchStore(null, fixedClock(0))).toThrow("watch: nil db");
  });

  it("covers defaults, bad args, and the due limit", () => {
    const { clock, store } = open(0);
    expect(store.maxWatches).toBe(50);
    expect(() => store.add("feeds__items_list", "null", "", 1, delivery("s"))).toThrow(/1m0s/);

    const watch = store.add("feeds__items_list", "{", "x", 60, delivery("s"));
    expect(watch.args).toBe("{}");
    expect(() => store.get(999)).toThrow(/not found/);
    expect(() => store.forceDueForTest(999)).toThrow(/not found/);

    store.cancel(watch.id);
    const listed = store.listSession("s", true);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.enabled).toBe(false);
    expect(store.due(clock.now(), 0)).toEqual([]);

    const other = store.add("feeds__other", null, "", 60, delivery("s"));
    const due = store.due(clock.now(), 0);
    expect(due.map((row) => row.id)).toEqual([other.id]);
  });

  it("collapses mouth sessions onto the agent session when reopened", () => {
    const { sql, clock, store } = open(5);
    const watch = store.add("feeds__items_list", null, "blog", 60, delivery("telegram:1:1", "1", "1"));
    expect(watch.sessionId).toBe("telegram:1:1");
    expect(watch.userId).toBe("");
    expect(watch.chatId).toBe("");

    const reopened = new WatchStore(sql, clock, 5);
    expect(reopened.get(watch.id).sessionId).toBe("agent");
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration").map((row) => row.id))
      .toEqual(["watch.001", "watch.002", "watch.003"]);
  });

  it("reports the earliest enabled next_poll_at", () => {
    const { store } = open();
    expect(store.nextDue()).toBeNull();
    const first = store.add("feeds__items_list", null, "", 60, delivery("s"));
    const second = store.add("feeds__other", null, "", 60, delivery("s"));
    expect(store.nextDue()).toBe(first.nextPollAt);
    store.forceDueForTest(second.id);
    expect(store.nextDue()).toBe(store.get(second.id).nextPollAt);
    store.cancel(first.id);
    store.cancel(second.id);
    expect(store.nextDue()).toBeNull();
  });
});

describe("migrate idempotence", () => {
  it("shares one sql handle across two stores", () => {
    const sql = memoryDb();
    const clock = fixedClock(AT);
    new WatchStore(sql, clock, 5);
    new WatchStore(sql, clock, 5);
    expect(sql.exec<{ id: string }>("SELECT id FROM brain_migration ORDER BY id").map((row) => row.id))
      .toEqual(["watch.001", "watch.002", "watch.003"]);
  });
});

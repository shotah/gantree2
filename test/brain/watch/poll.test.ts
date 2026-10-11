import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { textResult } from "@/brain/core/tools";
import { asleepAt } from "@/brain/cron/hours";
import { consumeRead } from "@/brain/plugins/twitter/budget";
import {
  AGENT_SESSION,
  TOOL_ADD,
  TOOL_LIST,
  WAKE_PREFIX,
  WatchStore,
  callWatchTool,
  quietResumeAt,
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
    expect(store.nextDue()).toBe(clock.now() + 5 * 60_000);
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
    expect(got?.nextPollAt).toBe(now + 30 * 60 * 1000);
    expect(got?.intervalSeconds).toBe(30 * 60);
    expect(got?.consecutiveErrors).toBe(1);
    expect(got?.state).toBe("active");
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

const SLEEP = "sleep: 23:00-07:00\nwork: 09:00-17:00\nquiet: (none)\n";

describe("poll policy", () => {
  it("wakes once for three due watches and says nothing when every watch is quiet", async () => {
    const { store, clock } = open();
    const fresh = ["blog", "news", "lab"].map((label) => {
      const watch = store.add("feeds__items_list", { url: `https://example.com/${label}` }, label, 60 * 60, { sessionId: "s" });
      prime(store, watch.id, ["old"]);
      return watch;
    });
    const fetchTool = scripted(fresh.map((watch) =>
      `{"items":[{"id":"old"},{"id":"${watch.label}-new","title":"${watch.label}"}]}`,
    ));
    const { onNewItems, wakes } = wakesOf();
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(fetchTool.calls.n).toBe(3);
    expect(wakes).toHaveLength(1);
    const text = wakes[0]?.text ?? "";
    expect(text.startsWith(WAKE_PREFIX)).toBe(true);
    expect(text).toContain("label: blog");
    expect(text).toContain("label: news");
    expect(text).toContain("label: lab");
    expect(text).toContain("id=blog-new");
    expect(text).toContain("id=news-new");
    expect(text).toContain("id=lab-new");
    expect(text).not.toContain("+");

    const quiet = Array.from({ length: 6 }, (_, i) => {
      const watch = store.add("feeds__items_list", { url: `https://example.com/q${i}` }, `q${i}`, 60 * 60, { sessionId: "s" });
      prime(store, watch.id, ["same"]);
      return watch;
    });
    const quietTool = scripted(quiet.map(() => `{"items":[{"id":"same"}]}`));
    await store.pollDue(clock.now(), quietTool.callTool, async () => {
      throw new Error("a quiet batch must not call the model");
    });
    expect(quietTool.calls.n).toBe(6);
  });

  it("caps the combined wake and keeps the overflow out of the model text", async () => {
    const { store, clock } = open();
    const watch = store.add("feeds__items_list", { url: "https://example.com/many" }, "many", 60 * 60, { sessionId: "s" });
    prime(store, watch.id, ["seed"]);
    const items = Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, title: `t${i}` }));
    const fetchTool = scripted([JSON.stringify({ items })]);
    const { onNewItems, wakes } = wakesOf();
    await store.pollDue(clock.now(), fetchTool.callTool, onNewItems);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.text).toContain("+1 more");
    expect(wakes[0]?.text).toContain("id=n0");
    expect(wakes[0]?.text).toContain("id=n19");
    expect(wakes[0]?.text).not.toContain("id=n20");
    expect(store.get(watch.id).seenIds).toContain("n20");
  });

  it("defers a due batch until the first grid slot after quiet hours", async () => {
    const { sql, store, clock } = open();
    store.setQuiet({
      resumeAt(at) {
        return quietResumeAt(SLEEP, at, "UTC");
      },
    });
    const watch = store.add("feeds__items_list", { url: "https://x" }, "blog", 60 * 60, { sessionId: "s" });
    sql.exec("UPDATE watch SET next_poll_at = ? WHERE id = ?", clock.now() - 1000, watch.id);
    const fetchTool = scripted([`{"items":[{"id":"n"}]}`]);
    await store.pollDue(clock.now(), fetchTool.callTool, async () => {
      throw new Error("quiet hours must not wake");
    });
    expect(fetchTool.calls.n).toBe(0);
    const resume = Date.UTC(2026, 0, 1, 7, 0, 0);
    expect(store.get(watch.id).nextPollAt).toBe(resume);
    expect(store.nextDue()).toBe(resume);
    expect(asleepAt(SLEEP, resume, "UTC")).toBe(false);
  });

  it("does not report a next alarm inside quiet hours", () => {
    const at = Date.UTC(2026, 0, 1, 22, 0, 0);
    const clock = fixedClock(at);
    const store = new WatchStore(
      memoryDb(),
      clock,
      10,
      makeLogger(memorySink(), () => clock.now()),
    );
    store.setQuiet({
      resumeAt(when) {
        return quietResumeAt(SLEEP, when, "UTC");
      },
    });
    const watch = store.add("feeds__items_list", { url: "https://x" }, "blog", 60 * 60, { sessionId: "s" });
    const inside = Date.UTC(2026, 0, 1, 23, 30, 0);
    store.sql.exec("UPDATE watch SET next_poll_at = ? WHERE id = ?", inside, watch.id);
    const due = store.nextDue();
    expect(due).toBe(Date.UTC(2026, 0, 2, 7, 0, 0));
    expect(asleepAt(SLEEP, inside, "UTC")).toBe(true);
    if (due == null) throw new Error("missing alarm");
    expect(asleepAt(SLEEP, due, "UTC")).toBe(false);
  });

  it("doubles the interval, pauses on the fifth error, and unpauses the same source", async () => {
    const { store, clock } = open();
    let calls = 0;
    const callTool: CallTool = async () => {
      calls += 1;
      throw new Error("boom");
    };
    const watch = store.add("feeds__items_list", { url: "https://x" }, "blog", 15 * 60, { sessionId: "s" });
    for (let i = 0; i < 4; i += 1) {
      store.forceDueForTest(watch.id);
      await store.pollDue(clock.now(), callTool, async () => {
        throw new Error("must not wake");
      });
      expect(store.get(watch.id).state).toBe("active");
    }
    store.forceDueForTest(watch.id);
    await store.pollDue(clock.now(), callTool, async () => {
      throw new Error("must not wake");
    });
    const paused = store.get(watch.id);
    expect(paused.state).toBe("paused");
    expect(paused.consecutiveErrors).toBe(5);
    expect(paused.intervalSeconds).toBe(8 * 60 * 60);
    expect(paused.lastError).toContain("boom");
    expect(calls).toBe(5);
    store.forceDueForTest(watch.id);
    await store.pollDue(clock.now(), callTool, async () => {
      throw new Error("paused watch must not fetch");
    });
    expect(calls).toBe(5);
    const listed = callWatchTool(store, TOOL_LIST, {}, { userId: "", sessionId: "s" });
    expect(listed).toContain("state=paused");
    expect(listed).toContain("last_error=");
    expect(listed).toContain("next_due=");
    expect(listed).toContain("boom");
    const again = callWatchTool(store, TOOL_ADD, {
      tool: "feeds__items_list",
      args: { url: "https://x" },
      interval: "15m",
      label: "blog",
    }, { userId: "u", sessionId: "s" });
    expect(again).toContain("(unpaused)");
    expect(store.get(watch.id).state).toBe("active");
    expect(store.get(watch.id).consecutiveErrors).toBe(0);
    expect(store.get(watch.id).intervalSeconds).toBe(15 * 60);
    expect(store.listSession("", false)).toHaveLength(1);
  });

  it("resets the backoff after a clean fetch", async () => {
    const { store, clock } = open();
    const watch = store.add("feeds__items_list", {}, "blog", 15 * 60, { sessionId: "s" });
    store.forceDueForTest(watch.id);
    await store.pollDue(clock.now(), async () => {
      throw new Error("boom");
    }, async () => {
      throw new Error("must not wake");
    });
    expect(store.get(watch.id).consecutiveErrors).toBe(1);
    store.forceDueForTest(watch.id);
    await store.pollDue(clock.now(), async () => textResult(`{"items":[{"id":"a"}]}`), async () => {
      throw new Error("seed must not wake");
    });
    const got = store.get(watch.id);
    expect(got.consecutiveErrors).toBe(0);
    expect(got.intervalSeconds).toBe(15 * 60);
    expect(got.lastError).toBe("");
    expect(got.seenIds).toEqual(["a"]);
  });

  it("treats 304 as no items and stores etag from a 200", async () => {
    const { sql, store, clock } = open();
    const watch = store.add("feeds__items_list", { url: "https://x" }, "blog", 60 * 60, { sessionId: "s" });
    prime(store, watch.id, ["a"]);
    sql.exec("UPDATE watch SET etag = ?, last_modified = ? WHERE id = ?", "\"v1\"", "Thu, 01 Jan 2026 00:00:00 GMT", watch.id);
    store.forceDueForTest(watch.id);
    let seenMatch = "";
    let seenSince = "";
    const callTool: CallTool = async (_name, args) => {
      seenMatch = typeof args.if_none_match === "string" ? args.if_none_match : "";
      seenSince = typeof args.if_modified_since === "string" ? args.if_modified_since : "";
      return textResult(JSON.stringify({ not_modified: true, etag: "\"v1\"", items: [] }));
    };
    await store.pollDue(clock.now(), callTool, async () => {
      throw new Error("304 must not wake");
    });
    expect(seenMatch).toBe("\"v1\"");
    expect(seenSince).toBe("Thu, 01 Jan 2026 00:00:00 GMT");
    expect(store.get(watch.id).seenIds).toEqual(["a"]);
    expect(store.get(watch.id).etag).toBe("\"v1\"");

    const other = store.add("feeds__items_list", { url: "https://y" }, "other", 60 * 60, { sessionId: "s" });
    prime(store, other.id, ["old"]);
    await store.pollDue(clock.now(), async () => textResult(JSON.stringify([{
      url: "https://y",
      items: [{ id: "old" }, { id: "new", title: "Fresh" }],
      etag: "W/\"2\"",
      last_modified: "Fri, 02 Jan 2026 00:00:00 GMT",
    }])), async () => undefined);
    expect(store.get(other.id).etag).toBe("W/\"2\"");
    expect(store.get(other.id).lastModified).toBe("Fri, 02 Jan 2026 00:00:00 GMT");
  });

  it("skips twitter watches until the monthly read budget rolls over", async () => {
    const { store, clock } = open();
    store.setTwitterReadLimit(1);
    consumeRead(store.sql, clock.now(), "UTC", 1);
    const watch = store.add("twitter__posts_list", { handle: "foo" }, "foo", 6 * 60 * 60, { sessionId: "s" });
    store.forceDueForTest(watch.id);
    let calls = 0;
    await store.pollDue(clock.now(), async () => {
      calls += 1;
      return textResult(`{"items":[{"id":"t"}]}`);
    }, async () => {
      throw new Error("over budget must not wake");
    });
    expect(calls).toBe(0);
    const parked = store.get(watch.id);
    expect(parked.consecutiveErrors).toBe(0);
    expect(parked.lastError).toContain("budget");
    expect(parked.lastError).toContain("resets");
    expect(parked.nextPollAt).toBe(Date.UTC(2026, 1, 1));
    clock.set(Date.UTC(2026, 1, 1));
    store.forceDueForTest(watch.id);
    await store.pollDue(clock.now(), async () => {
      calls += 1;
      return textResult(`{"items":[{"id":"t"}]}`);
    }, async () => undefined);
    expect(calls).toBe(1);
  });
});

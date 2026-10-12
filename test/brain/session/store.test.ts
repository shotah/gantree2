import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink, silentLogger } from "@/brain/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import {
  defaultMaxEstTokens,
  defaultMaxMessages,
  estTokens,
  roleAssistant,
  roleUser,
  roomSession,
  SessionStore,
} from "@/brain/session";

const at = Date.parse("2026-08-17T16:22:00.000Z");

function memoryDb(): Sql {
  // `DatabaseSync` types its bindings narrower than `SqlValue` (no ArrayBuffer); the runtime accepts them.
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

function open(maxMessages: number, maxEstTokens: number, sql?: Sql) {
  const clock = fixedClock(at);
  const sink = memorySink();
  const store = new SessionStore(sql ?? memoryDb(), clock, makeLogger(sink, () => clock.now()), {
    maxMessages,
    maxEstTokens,
  });
  return { store, clock, sink };
}

describe("SessionStore", () => {
  it("trims to maxMessages, reports stats, and reset clears history", async () => {
    const { store } = open(4, 100_000);
    const id = "telegram:1:2";
    for (let i = 0; i < 3; i++) {
      await store.append(id, { role: roleUser, content: "u" }, { role: roleAssistant, content: "a" });
    }
    const msgs = store.messages(id);
    expect(msgs).toHaveLength(4);
    const stats = store.stats(id);
    expect(stats.messages).toBe(4);
    expect(stats.estTokens).toBeGreaterThan(0);
    store.reset(id);
    expect(store.messages(id)).toEqual([]);
    expect(store.summary(id)).toBe("");
  });

  it("skips cron rows in lastUserAt and userActiveSince", async () => {
    const { store, clock } = open(20, 100_000);
    const id = "contact";
    expect(store.lastUserAt(id)).toBeNull();
    const before = clock.now() - 1000;
    await store.append(id, { role: roleUser, content: "hi" }, { role: roleAssistant, content: "hello" });
    expect(store.lastUserAt(id)).toBe(clock.now());
    await store.append(
      id,
      { role: roleUser, content: "[cron] Daily planner — one planning session" },
      { role: roleAssistant, content: "[silent]" },
    );
    expect(store.lastUserAt(id)).toBe(clock.now());
    expect(store.userActiveSince(id, before)).toBe(true);
    expect(store.userActiveSince(id, clock.now() + 1)).toBe(false);
  });

  it("defaults bounds and rejects an invalid role", async () => {
    const store = new SessionStore(memoryDb(), fixedClock(at), silentLogger, {
      maxMessages: 0,
      maxEstTokens: 0,
    });
    expect(store.maxMessages).toBe(defaultMaxMessages);
    expect(store.maxEstTokens).toBe(defaultMaxEstTokens);
    await store.append("s");
    expect(store.messages("s")).toEqual([]);
    await expect(store.append("s", { role: "system", content: "nope" })).rejects.toThrow(/invalid role/);
    expect(store.messages("s")).toEqual([]);
  });

  it("trims on the token budget and keeps at least two messages", async () => {
    const { store } = open(100, 10);
    const big = "x".repeat(80);
    for (let i = 0; i < 5; i++) {
      await store.append("s", { role: roleUser, content: big }, { role: roleAssistant, content: big });
    }
    const msgs = store.messages("s");
    expect(msgs.length).toBeLessThanOrEqual(4);
    if (estTokens(msgs) > 10) {
      expect(msgs.length).toBeLessThanOrEqual(2);
    }
  });

  it("collapses mouth history into the agent session on open", async () => {
    const db = new DatabaseSync(":memory:") as unknown as NodeDatabase;
    const sql = nodeSql(db);
    const { store } = open(20, 100_000, sql);
    await store.append(
      "telegram:1:2",
      { role: roleUser, content: "hi" },
      { role: roleAssistant, content: "hey" },
    );
    const again = open(20, 100_000, nodeSql(db)).store;
    expect(again.messages("telegram:1:2")).toEqual([]);
    const msgs = again.messages(roomSession(""));
    expect(msgs.map((m) => m.content)).toEqual(["hi", "hey"]);
  });

  it("skips the trim when the summary fold throws", async () => {
    const { store, sink } = open(4, 100_000);
    store.withSummarizer({
      fold() {
        return Promise.reject(new Error("boom"));
      },
    });
    for (let i = 0; i < 3; i++) {
      await store.append("s", { role: roleUser, content: "u" }, { role: roleAssistant, content: "a" });
    }
    expect(store.messages("s")).toHaveLength(6);
    expect(store.summary("s")).toBe("");
    expect(sink.records.some((r) => r.level === "warn" && r.message.includes("skipping trim"))).toBe(true);
  });
});

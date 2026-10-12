import { describe, expect, it } from "vitest";
import { silentLogger } from "@/harness/core";
import {
  ensureConsolidateAttempts,
  EPISODE_TTL_MS,
  formatHydration,
  isNotSupported,
  KIND_FACT,
  KIND_INSIGHT,
  KIND_PERSON,
  KIND_PREFERENCE,
  MemoryStore,
  NotSupportedError,
  resolvePin,
  SUBJECT_AIM_PREFIX,
  SUBJECT_HOURS,
  SUBJECT_WAITING_PREFIX,
} from "@/harness/memory";
import { memorySql, openMemory } from "./fixture";

describe("schema", () => {
  it("creates the harness tables once", () => {
    const { sql, clock } = openMemory();
    new MemoryStore(sql, clock, silentLogger);
    expect(sql.exec("SELECT id FROM brain_migration WHERE id LIKE 'memory.%' ORDER BY id").map((r) => r.id))
      .toEqual(["memory.001", "memory.002"]);
    expect(sql.exec("PRAGMA table_info(memory)").map((r) => (typeof r.name === "string" ? r.name : ""))).toEqual([
      "id",
      "kind",
      "subject",
      "content",
      "source",
      "confidence",
      "created_at",
      "updated_at",
      "expires_at",
      "superseded_by",
      "consolidated",
      "consolidate_attempts",
    ]);
    expect(sql.one("SELECT name FROM sqlite_master WHERE name = 'memory_fts'")).not.toBeNull();
    expect(sql.exec("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'memory' ORDER BY name").map((r) => (typeof r.name === "string" ? r.name : "")))
      .toEqual(["memory_ad", "memory_ai", "memory_au"]);
  });

  it("adds consolidate_attempts when a copied table predates the column", () => {
    const sql = memorySql();
    sql.exec(`CREATE TABLE memory (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      superseded_by INTEGER,
      consolidated INTEGER NOT NULL DEFAULT 0
    )`);
    ensureConsolidateAttempts(sql);
    ensureConsolidateAttempts(sql);
    const names = sql.exec("PRAGMA table_info(memory)").filter((r) => r.name === "consolidate_attempts");
    expect(names).toHaveLength(1);
  });
});

describe("store", () => {
  it("stores, recalls, and forgets", () => {
    const { store } = openMemory();
    const e = store.store(KIND_PREFERENCE, "ada", "coaching tone, no fluff");
    expect(e.id).not.toBe(0);
    const hits = store.recall("coaching", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toBe(e.content);
    store.forget(e.id);
    expect(store.recall("coaching", 10)).toEqual([]);
    expect(() => store.forget(e.id)).toThrow(/not found/);
  });

  it("rejects a bad kind and an empty subject", () => {
    const { store } = openMemory();
    expect(() => store.store("mood", "a", "b")).toThrow(/invalid kind/);
    expect(() => store.store(KIND_FACT, "  ", "b")).toThrow(/required/);
    expect(() => store.store(KIND_FACT, "a", " ")).toThrow(/required/);
  });

  it("hydrates a block and forgets by query", () => {
    const { store } = openMemory();
    store.store(KIND_FACT, "climbing", "trains Tue/Thu");
    store.store("episode", "today", "skipped gym while traveling");
    const hydrated = store.hydrate("traveling", 30);
    expect(hydrated.length).toBeGreaterThanOrEqual(1);
    const block = formatHydration(hydrated, "UTC");
    expect(block.startsWith("[memory]")).toBe(true);
    expect(store.forgetQuery("climbing")).toBeGreaterThanOrEqual(1);
  });

  it("keeps history when consolidation supersedes an episode", () => {
    const { store } = openMemory();
    const ep1 = store.store("episode", "ada", "likes espresso");
    const ep2 = store.store("episode", "ada", "drinks espresso every morning");
    expect(store.listUnconsolidatedEpisodes(20)).toHaveLength(2);
    const neu = store.storeConsolidated(KIND_PREFERENCE, "ada", "drinks espresso every morning");
    store.supersede(ep1.id, neu.id);
    store.markConsolidated([ep1.id, ep2.id]);
    expect(store.listUnconsolidatedEpisodes(20)).toEqual([]);
    for (const h of store.recall("espresso", 20)) {
      expect(h.id).not.toBe(ep1.id);
    }
  });

  it("supersedes the same durable subject and leaves episodes alone", () => {
    const { store } = openMemory();
    const old = store.store(KIND_PREFERENCE, "pref/food", "dislikes sushi");
    const neu = store.store(KIND_PREFERENCE, "pref/food", "likes sushi now");
    expect(neu.id).not.toBe(old.id);
    const got = store.get(old.id);
    expect(got.supersededBy).toBe(neu.id);
    const live = store.activeByKindSubject(KIND_PREFERENCE, "pref/food");
    expect(live?.id).toBe(neu.id);
    expect(live?.content).toBe("likes sushi now");
    for (const e of store.hydrate("sushi", 30)) {
      expect(e.id).not.toBe(old.id);
    }
    const pin = resolvePin(store, old.id, "");
    expect(pin?.id).toBe(neu.id);

    const ep1 = store.store("episode", "ada", "note one");
    const ep2 = store.store("episode", "ada", "note two");
    expect(ep1.id).not.toBe(ep2.id);
    expect(store.listUnconsolidatedEpisodes(20).length).toBeGreaterThanOrEqual(2);
  });

  it("resolves a pin by subject and stops on a supersede cycle", () => {
    const { store } = openMemory();
    store.store(KIND_PREFERENCE, "pref/food", "tacos");
    expect(resolvePin(store, 0, "pref/food")?.content).toBe("tacos");
    expect(resolvePin(store, 999, "pref/food")?.content).toBe("tacos");
    expect(resolvePin(store, 0, "")).toBeNull();
    expect(resolvePin(null, 1, "pref/food")).toBeNull();

    const a = store.store(KIND_FACT, "cycle/a", "one");
    const b = store.store(KIND_FACT, "cycle/b", "two");
    store.supersede(a.id, b.id);
    store.supersede(b.id, a.id);
    expect(resolvePin(store, a.id, "")).not.toBeNull();
  });

  it("lists live rows by subject prefix", () => {
    const { store } = openMemory();
    store.store(KIND_INSIGHT, "aim/training", "3x gym");
    store.store(KIND_INSIGHT, "aim/spanish", "B1");
    store.store(KIND_FACT, "waiting/dentist", "book");
    store.store(KIND_PREFERENCE, SUBJECT_HOURS, "sleep: 22:00-06:00");
    expect(store.listBySubjectPrefix(KIND_INSIGHT, SUBJECT_AIM_PREFIX, 5)).toHaveLength(2);
    const wait = store.listBySubjectPrefix(KIND_FACT, SUBJECT_WAITING_PREFIX, 5);
    expect(wait).toHaveLength(1);
    expect(wait[0]?.subject).toBe("waiting/dentist");
    expect(store.listBySubjectPrefix(KIND_INSIGHT, "nope/", 5)).toEqual([]);
    expect(store.listBySubjectPrefix("", SUBJECT_AIM_PREFIX, 5)).toEqual([]);
    expect(store.listBySubjectPrefix(KIND_FACT, "", 5)).toEqual([]);
  });

  it("lists active rows newest first when the query is empty", () => {
    const { store, clock } = openMemory();
    store.store(KIND_FACT, "a", "older");
    clock.tick(1000);
    store.store(KIND_FACT, "b", "newer");
    expect(store.recall("", 10).map((e) => e.subject)).toEqual(["b", "a"]);
    expect(store.recall("   ", 10)).toHaveLength(2);
  });

  it("falls back to LIKE search", () => {
    const { store } = openMemory();
    store.store(KIND_FACT, "ada", "likes quiet mornings");
    const hits = store.searchLike("quiet", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.subject).toBe("ada");
  });

  it("expires episodes after 30 days and keeps durable facts", () => {
    const { store, clock } = openMemory();
    store.store(KIND_FACT, "home", "denver");
    const ep = store.store("episode", "trip", "was in denver");
    expect(store.recall("denver", 10).map((e) => e.id)).toContain(ep.id);
    clock.tick(EPISODE_TTL_MS - 1);
    expect(store.recall("denver", 10).map((e) => e.id)).toContain(ep.id);
    clock.tick(1);
    expect(store.recall("denver", 10).map((e) => e.kind)).toEqual([KIND_FACT]);
  });

  it("counts rows for memstats", () => {
    const { store } = openMemory();
    store.store(KIND_FACT, "a", "one");
    store.store(KIND_PREFERENCE, "b", "two");
    const snap = store.stats();
    expect(snap.total).toBe(2);
    expect(snap.active).toBe(2);
    expect(snap.byKind[KIND_FACT]).toBe(1);
    expect(snap.byKind[KIND_PREFERENCE]).toBe(1);
    expect(snap.byKind[KIND_PERSON]).toBe(0);
    expect(snap.expired).toBe(0);
    expect(snap.superseded).toBe(0);
    expect(snap.backlog).toBe(0);
    expect(snap.dbBytes).toBeGreaterThan(0);
  });

  it("names the not-supported sentinel", () => {
    expect(isNotSupported(new NotSupportedError())).toBe(true);
    expect(isNotSupported(new Error("memory: id 1 not found"))).toBe(false);
  });
});

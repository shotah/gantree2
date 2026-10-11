import { describe, expect, it } from "vitest";
import { silentLogger, type ChatProvider } from "@/brain/core";
import {
  buildConsolidatePrompt,
  Consolidator,
  KIND_EPISODE,
  KIND_FACT,
  KIND_PREFERENCE,
  SOURCE_CONSOLIDATION,
} from "@/brain/memory";
import { entry, openMemory } from "./fixture";

function scripted(body: string): ChatProvider {
  const result = { content: body, toolCalls: [] as [], usage: { prompt: 0, completion: 0 } };
  return {
    complete: () => Promise.resolve(result),
    completeStream: () => Promise.resolve(result),
  };
}

describe("consolidator", () => {
  it("extracts a preference and marks the episode", async () => {
    const { store, clock } = openMemory();
    const ep = store.store(KIND_EPISODE, "ada", "likes quiet mornings");
    const c = new Consolidator(
      store,
      scripted(`[{"kind":"preference","subject":"ada","content":"likes quiet mornings","supersedes":[]}]`),
      clock,
      silentLogger,
      { batchSize: 10 },
    );
    await c.pass();
    expect(store.listUnconsolidatedEpisodes(20)).toEqual([]);
    const hits = store.recall("quiet", 10);
    expect(hits.some((h) => h.kind === KIND_PREFERENCE && h.source === SOURCE_CONSOLIDATION)).toBe(true);
    expect(hits.some((h) => h.id === ep.id)).toBe(false);
    expect(c.lastStatus().at).toBe(clock.now());
    expect(c.lastStatus().error).toBeNull();
  });

  it("does not mark the episode when the reply is not json", async () => {
    const { store, clock } = openMemory();
    const ep = store.store(KIND_EPISODE, "ada", "keep me");
    const c = new Consolidator(store, scripted("not-json-".repeat(40)), clock, silentLogger, { batchSize: 10 });
    await c.pass();
    const list = store.listUnconsolidatedEpisodes(20);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(ep.id);
  });

  it("does not mark the episode on an empty reply", async () => {
    const { store, clock } = openMemory();
    store.store(KIND_EPISODE, "ada", "empty reply case");
    const c = new Consolidator(store, scripted("   "), clock, silentLogger, { batchSize: 10 });
    await c.pass();
    expect(store.listUnconsolidatedEpisodes(20)).toHaveLength(1);
  });

  it("marks the episode when the model returns an empty array", async () => {
    const { store, clock } = openMemory();
    store.store(KIND_EPISODE, "ada", "chitchat only");
    const c = new Consolidator(store, scripted("[]"), clock, silentLogger, { batchSize: 10 });
    await c.pass();
    expect(store.listUnconsolidatedEpisodes(20)).toEqual([]);
  });

  it("quarantines an episode after three failed passes", async () => {
    const { store, clock } = openMemory();
    const ep = store.store(KIND_EPISODE, "ada", "poison");
    const c = new Consolidator(store, scripted("not-json"), clock, silentLogger, { batchSize: 10 });
    for (let i = 0; i < 3; i += 1) {
      await c.pass();
    }
    expect(store.listUnconsolidatedEpisodes(20)).toEqual([]);
    expect(store.recall("poison", 10).some((h) => h.id === ep.id)).toBe(false);
    expect(store.stats().quarantined).toBe(1);
    expect(store.stats().backlog).toBe(0);
  });

  it("supersedes only ids from the episode batch", async () => {
    const { store, clock } = openMemory();
    const keep = store.store(KIND_FACT, "ada", "keep this fact");
    const ep = store.store(KIND_EPISODE, "ada", "new note");
    const body = `[{"kind":"fact","subject":"ada","content":"new note","supersedes":[${String(keep.id)},${String(ep.id)}]}]`;
    const c = new Consolidator(store, scripted(body), clock, silentLogger, { batchSize: 10 });
    await c.pass();
    expect(store.get(keep.id).supersededBy).toBeNull();
    expect(store.recall("keep this fact", 10).some((h) => h.id === keep.id)).toBe(true);
    expect(store.get(ep.id).supersededBy).not.toBeNull();
    expect(store.listUnconsolidatedEpisodes(20)).toEqual([]);
  });

  it("returns immediately when the interval is disabled", async () => {
    const { store, clock } = openMemory();
    const c = new Consolidator(store, scripted("[]"), clock, silentLogger, { intervalMs: 0 });
    await c.start(new AbortController().signal);
    expect(c.lastStatus().at).toBe(0);
  });

  it("strips a json fence on the boot pass and stops when aborted", async () => {
    const { store, clock } = openMemory();
    store.store(KIND_EPISODE, "ada", "walks at dawn");
    const body = "```json\n[{\"kind\":\"fact\",\"subject\":\"ada\",\"content\":\"walks at dawn\",\"supersedes\":[]}]\n```";
    const c = new Consolidator(store, scripted(body), clock, silentLogger, { intervalMs: 15, batchSize: 0 });
    const ac = new AbortController();
    const done = c.start(ac.signal);
    try {
      const deadline = Date.now() + 1000;
      let left = -1;
      while (Date.now() < deadline) {
        left = store.listUnconsolidatedEpisodes(20).length;
        if (left === 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(left).toBe(0);
    } finally {
      ac.abort();
      await done;
    }
  });

  it("includes the local recorded date in the prompt", () => {
    const got = buildConsolidatePrompt([entry({
      id: 3,
      subject: "today",
      content: "skipped gym",
      createdAt: Date.parse("2026-08-10T21:00:00-07:00"),
    })], "America/Los_Angeles");
    expect(got).toContain("recorded=Mon 2026-08-10");
    expect(got).not.toContain("2026-08-11");
  });
});

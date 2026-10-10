import { describe, expect, it } from "vitest";
import { QUEUE_BYTES_MAX, QUEUE_MAX, QUEUE_TTL_MS, utf8Bytes } from "@/lib/chat/caps";
import {
  destKey,
  drainFor,
  enqueue,
  matchesFlush,
  mergeCursor,
  newQueueId,
  peekFor,
  phoneMayDeleteQueued,
  dropAcked,
  pruneQueue,
  queuedFromList,
  queueIdentity,
  queueStoreKey,
  seqForSince,
  shouldQueue,
  type Queued,
} from "@/lib/chat/queue";

function msg(over: Partial<Queued> = {}): Queued {
  const base = { id: "1", to: "phone" as const, body: "{}", at: 1_000 };
  const merged = { ...base, ...over };
  return { ...merged, bytes: over.bytes ?? utf8Bytes(merged.body) };
}

describe("queue", () => {
  it("drops stale items and keeps a short live list", () => {
    const stale = msg({ id: "old", at: 0 });
    const live = msg({ id: "new", at: QUEUE_TTL_MS });
    expect(pruneQueue([stale, live], QUEUE_TTL_MS + 1).map((m) => m.id)).toEqual(["new"]);
  });

  it("caps length by dropping the oldest", () => {
    const items = Array.from({ length: QUEUE_MAX }, (_, i) => msg({ id: String(i), at: 10 }));
    const next = enqueue(items, msg({ id: "tail", at: 10 }), { now: 10, max: QUEUE_MAX });
    expect(next).toHaveLength(QUEUE_MAX);
    expect(next[0]?.id).toBe("1");
    expect(next.at(-1)?.id).toBe("tail");
  });

  it("drains one side and leaves the other", () => {
    const items = [
      msg({ id: "p", to: "phone", at: 5 }),
      msg({ id: "c", to: "crane", at: 5 }),
    ];
    const { kept, take } = drainFor(items, "phone", 5);
    expect(take.map((m) => m.id)).toEqual(["p"]);
    expect(kept.map((m) => m.id)).toEqual(["c"]);
  });

  it("mints ids", () => {
    expect(newQueueId(1, () => 0.5)).toMatch(/^1-/);
  });

  it("replaces a row put again under the same (id, to) — latest body, one row", () => {
    const first = msg({ id: "r1", to: "crane", body: '{"text":"👍"}', at: 10 });
    const again = msg({ id: "r1", to: "crane", body: '{"text":"❤️"}', at: 20 });
    const other = msg({ id: "r1", to: "phone", body: '{"text":"reply"}', at: 5 });
    const next = enqueue([other, first], again, { now: 20 });
    expect(next.filter((m) => queueIdentity(m) === "crane:r1")).toEqual([again]);
    expect(next.filter((m) => queueIdentity(m) === "phone:r1")).toEqual([other]);
  });

  it("does not queue pin, ack, cmds, typing, draft, or react on its own", () => {
    expect(shouldQueue("pin")).toBe(false);
    expect(shouldQueue("ack")).toBe(false);
    expect(shouldQueue("cmds")).toBe(false);
    expect(shouldQueue("typing")).toBe(false);
    expect(shouldQueue("draft")).toBe(false);
    expect(shouldQueue("react")).toBe(false); // the Worker queues a phone react for a down crane itself
    expect(shouldQueue("aims")).toBe(false); // boards are stored latest-wins and replayed, not queued
    expect(shouldQueue("todo")).toBe(false);
    expect(shouldQueue("inbound")).toBe(true);
    expect(shouldQueue("reply")).toBe(true);
    expect(shouldQueue("push")).toBe(true);
  });

  it("drops oldest non-reply first under the byte cap", () => {
    const items = [
      msg({ id: "r1", kind: "reply", at: 1, bytes: 8, body: "rrrrrrrr" }),
      msg({ id: "i1", kind: "inbound", at: 2, bytes: 8, body: "iiiiiiii" }),
    ];
    const next = enqueue(items, msg({ id: "r2", kind: "reply", at: 3, bytes: 8, body: "rrrrrrrr" }), {
      now: 3,
      bytesMax: 20,
    });
    expect(next.map((m) => m.id)).toEqual(["r1", "r2"]);
  });

  it("drops oldest reply only when nothing else remains", () => {
    const items = [
      msg({ id: "r1", kind: "reply", at: 1, bytes: 8 }),
      msg({ id: "r2", kind: "reply", at: 2, bytes: 8 }),
    ];
    const next = enqueue(items, msg({ id: "r3", kind: "reply", at: 3, bytes: 8 }), {
      now: 3,
      bytesMax: 20,
    });
    expect(next.map((m) => m.id)).toEqual(["r2", "r3"]);
  });

  it("caps bytes per destination key, not globally", () => {
    const ada = msg({ id: "a1", userId: "ada", at: 1, bytes: 8 });
    const bob = msg({ id: "b1", userId: "bob", at: 1, bytes: 8 });
    let next = enqueue([ada], bob, { now: 1, bytesMax: 10 });
    next = enqueue(next, msg({ id: "a2", userId: "ada", at: 2, bytes: 8 }), { now: 2, bytesMax: 10 });
    expect(next.map((m) => m.id).sort()).toEqual(["a2", "b1"]);
  });

  it("peeks phone items for one sub plus broadcasts and preserves order", () => {
    const items = [
      msg({ id: "ada-1", userId: "ada", at: 1 }),
      msg({ id: "all", userId: "", at: 2 }),
      msg({ id: "bob-1", userId: "bob", at: 3 }),
      msg({ id: "ada-2", userId: "ada", at: 4 }),
      msg({ id: "crane-1", to: "crane", at: 5 }),
    ];
    expect(peekFor(items, "phone", 10, { userId: "ada" }).map((m) => m.id)).toEqual(["ada-1", "all", "ada-2"]);
    expect(peekFor(items, "phone", 10, { userId: "bob" }).map((m) => m.id)).toEqual(["all", "bob-1"]);
    expect(peekFor(items, "crane", 10).map((m) => m.id)).toEqual(["crane-1"]);
    const drained = drainFor(items, "phone", 10, QUEUE_TTL_MS, "ada");
    expect(drained.take.map((m) => m.id)).toEqual(["ada-1", "all", "ada-2"]);
    expect(drained.kept.map((m) => m.id)).toEqual(["bob-1", "crane-1"]);
  });

  it("skips ids at or before since", () => {
    const items = [
      msg({ id: "a", userId: "ada", at: 1 }),
      msg({ id: "b", userId: "ada", at: 2 }),
      msg({ id: "c", userId: "ada", at: 3 }),
    ];
    expect(peekFor(items, "phone", 10, { userId: "ada", since: "b" }).map((m) => m.id)).toEqual(["c"]);
  });

  it("holds a walk-sized photo plus three texts under the 8 MiB cap", () => {
    const photo = "x".repeat(1_400_000);
    let q: Queued[] = [];
    q = enqueue(q, msg({ id: "photo", to: "crane", body: photo, at: 1, kind: "inbound" }), { now: 1 });
    q = enqueue(q, msg({ id: "t1", to: "crane", body: "one", at: 2, kind: "inbound" }), { now: 2 });
    q = enqueue(q, msg({ id: "t2", to: "crane", body: "two", at: 3, kind: "inbound" }), { now: 3 });
    q = enqueue(q, msg({ id: "t3", to: "crane", body: "three", at: 4, kind: "inbound" }), { now: 4 });
    expect(q.map((m) => m.id)).toEqual(["photo", "t1", "t2", "t3"]);
    expect(q.reduce((n, m) => n + m.bytes, 0)).toBeLessThan(QUEUE_BYTES_MAX);
    expect(peekFor(q, "crane", 4).map((m) => m.id)).toEqual(["photo", "t1", "t2", "t3"]);
  });

  it("sorts storage rows by time and names keys q:<to>:<id>", () => {
    expect(queueStoreKey("abc", "phone")).toBe("q:phone:abc");
    expect(queueStoreKey("abc", "crane")).toBe("q:crane:abc");
    expect(queueIdentity({ id: "abc", to: "phone" })).toBe("phone:abc");
    expect(destKey("phone", "ada")).toBe("phone:ada");
    expect(destKey("crane")).toBe("crane:");
    const rows = new Map<string, Queued>([
      ["q:phone:b", msg({ id: "b", at: 2 })],
      ["q:phone:a", msg({ id: "a", at: 1 })],
    ]);
    expect(queuedFromList(rows).map((m) => m.id)).toEqual(["a", "b"]);
    const inverted = new Map<string, Queued>([
      ["q:phone:b", msg({ id: "b", seq: 2, at: 1 })],
      ["q:phone:a", msg({ id: "a", seq: 1, at: 9 })],
    ]);
    expect(queuedFromList(inverted).map((m) => m.id)).toEqual(["a", "b"]);
    expect(matchesFlush(msg({ to: "phone", userId: "ada" }), "phone", "ada")).toBe(true);
    expect(matchesFlush(msg({ to: "phone", userId: "bob" }), "phone", "ada")).toBe(false);
  });

  it("does not let Bob's ack delete Ada's row or a broadcast", () => {
    expect(phoneMayDeleteQueued(msg({ to: "phone", userId: "ada" }), "bob")).toBe(false);
    expect(phoneMayDeleteQueued(msg({ to: "phone", userId: "ada" }), "ada")).toBe(true);
    expect(phoneMayDeleteQueued(msg({ to: "phone", userId: "" }), "ada")).toBe(false);
    expect(phoneMayDeleteQueued(msg({ to: "crane", userId: "ada" }), "ada")).toBe(false);
    const items = [
      msg({ id: "ada-1", userId: "ada", seq: 1, at: 1 }),
      msg({ id: "all", userId: "", seq: 2, at: 2 }),
      msg({ id: "bob-1", userId: "bob", seq: 3, at: 3 }),
    ];
    expect(dropAcked(items, { since: "ada-1", userId: "ada" }).map((m) => m.id)).toEqual(["all", "bob-1"]);
  });

  it("peeks by seq, not lexical id", () => {
    const uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const items = [
      msg({ id: uuid, userId: "ada", seq: 1, at: 1 }),
      msg({ id: "m-reply", userId: "ada", seq: 2, at: 2 }),
    ];
    expect(peekFor(items, "phone", 10, { userId: "ada", since: uuid }).map((m) => m.id)).toEqual(["m-reply"]);
    expect(peekFor(items, "phone", 10, { userId: "ada", sinceSeq: 1 }).map((m) => m.id)).toEqual(["m-reply"]);
    expect(seqForSince(items, uuid)).toBe(1);
    const scrambled = [
      msg({ id: "b", userId: "ada", seq: 2, at: 1 }),
      msg({ id: "a", userId: "ada", seq: 1, at: 9 }),
    ];
    expect(peekFor(scrambled, "phone", 10, { userId: "ada" }).map((m) => m.id)).toEqual(["a", "b"]);
    expect(seqForSince(items, "2")).toBe(2);
    expect(mergeCursor(0, 3)).toBe(3);
    expect(mergeCursor(5, 2)).toBe(5);
  });

  it("keeps the same frame id for phone history and a crane catch-up copy", () => {
    const crane = msg({ id: "same", to: "crane", at: 1, kind: "inbound" });
    const phone = msg({ id: "same", to: "phone", userId: "ada", at: 1, kind: "inbound" });
    const next = enqueue([crane], phone, { now: 1 });
    expect(next.map((m) => `${m.to}:${m.id}`).sort()).toEqual(["crane:same", "phone:same"]);
    expect(peekFor(next, "phone", 1, { userId: "ada" }).map((m) => m.id)).toEqual(["same"]);
    expect(peekFor(next, "crane", 1).map((m) => m.id)).toEqual(["same"]);
  });
});

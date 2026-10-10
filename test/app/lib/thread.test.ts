import { describe, expect, it } from "vitest";
import {
  ackSince,
  advanceCursor,
  capThread,
  cursorOf,
  failInThread,
  mergeThread,
  persistableThread,
  placeInThread,
  rememberSeen,
  sameThread,
  type ThreadOrder,
} from "@/app/lib/thread";

describe("thread caps", () => {
  it("keeps the newest messages", () => {
    expect(capThread([1, 2, 3], 2)).toEqual([2, 3]);
    expect(capThread([1, 2], 5)).toEqual([1, 2]);
  });

  it("drops oldest seen ids first", () => {
    const seen = new Set(["a", "b", "c"]);
    rememberSeen(seen, "d", 3);
    expect([...seen]).toEqual(["b", "c", "d"]);
  });

  it("inserts catch-up by seq and keeps a draft last", () => {
    const late: ThreadOrder = { id: "b", at: 20, seq: 2 };
    const early: ThreadOrder = { id: "a", at: 10, seq: 1 };
    const draft: ThreadOrder = { id: "__draft__", at: 1, kind: "draft" };
    const ordered = placeInThread(placeInThread([late], early), draft);
    expect(ordered.map((m) => m.id)).toEqual(["a", "b", "__draft__"]);
    const pending = placeInThread<ThreadOrder>(
      [{ id: "mine", at: 50 }],
      { id: "missed", at: 40, seq: 4 },
    );
    expect(pending.map((m) => m.id)).toEqual(["missed", "mine"]);
  });

  it("marks the rejected bubble failed by id, else the newest pending one of yours", () => {
    type Bubble = ThreadOrder & { from: "you" | "kit"; pending?: boolean; failed?: string };
    const thread: Bubble[] = [
      { id: "old", at: 1, from: "you", pending: true },
      { id: "kit", at: 2, from: "kit" },
      { id: "new", at: 3, from: "you", pending: true },
      { id: "done", at: 4, from: "you" },
    ];
    const byId = failInThread(thread, "old", "Not sent.");
    expect(byId.find((m) => m.id === "old")).toEqual({ id: "old", at: 1, from: "you", failed: "Not sent.", pending: false });
    expect(byId.find((m) => m.id === "new")?.pending).toBe(true);
    const newest = failInThread(thread, undefined, "Not sent.");
    expect(newest.find((m) => m.id === "new")).toMatchObject({ failed: "Not sent.", pending: false });
    expect(newest.find((m) => m.id === "old")?.pending).toBe(true);
    const unknownId = failInThread(thread, "nope", "Not sent.");
    expect(unknownId.find((m) => m.id === "new")).toMatchObject({ failed: "Not sent.", pending: false });
    const settled: Bubble[] = [{ id: "done", at: 4, from: "you" }, { id: "kit", at: 5, from: "kit" }];
    expect(failInThread(settled, undefined, "Not sent.")).toBe(settled);
  });

  it("acks the highest seq, not the last arrival", () => {
    let cur = advanceCursor({ seq: 0 }, { id: "b", seq: 2 });
    cur = advanceCursor(cur, { id: "a", seq: 1 });
    expect(ackSince(cur)).toBe("2");
    expect(ackSince({ id: "legacy", seq: 0 })).toBe("legacy");
  });
});

describe("thread on the device", () => {
  type Bubble = ThreadOrder & { pending?: boolean; failed?: string };

  it("keeps settled bubbles and drops sending ones and the draft", () => {
    const thread: Bubble[] = [
      { id: "a", at: 1, seq: 1 },
      { id: "mine", at: 2, pending: true },
      { id: "refused", at: 3, failed: "Not sent." },
      { id: "__draft__", at: 4, kind: "draft" },
    ];
    expect(persistableThread(thread).map((m) => m.id)).toEqual(["a", "refused"]);
  });

  it("strips live so a reload cannot keep the draft React key", () => {
    type LiveBubble = Bubble & { live?: boolean };
    const thread: LiveBubble[] = [
      { id: "a", at: 1, seq: 1 },
      { id: "r1", at: 2, seq: 2, live: true },
    ];
    const next = persistableThread(thread);
    expect(next.map((m) => m.id)).toEqual(["a", "r1"]);
    expect(next.find((m) => m.id === "r1")?.live).toBe(false);
    expect(thread.find((m) => m.id === "r1")?.live).toBe(true);
  });

  it("knows when nothing changed so it can skip the write", () => {
    const a = { id: "a", at: 1 };
    const b = { id: "b", at: 2 };
    expect(sameThread([a, b], [a, b])).toBe(true);
    expect(sameThread([a, b], [a])).toBe(false);
    expect(sameThread([a, b], [a, { ...b }])).toBe(false);
    expect(sameThread([], [])).toBe(true);
  });

  it("folds the cached copy under what the socket already painted, live winning on a clash", () => {
    const cached: ThreadOrder[] = [
      { id: "a", at: 10, seq: 1 },
      { id: "b", at: 20, seq: 2 },
      { id: "c", at: 30, seq: 3 },
    ];
    const liveB: ThreadOrder = { id: "b", at: 21, seq: 2 };
    const liveD: ThreadOrder = { id: "d", at: 40, seq: 4 };
    const merged = mergeThread(cached, [liveD, liveB]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(merged.find((m) => m.id === "b")).toBe(liveB);
  });

  it("returns the live thread untouched when there is nothing cached", () => {
    const live: ThreadOrder[] = [{ id: "x", at: 1 }];
    const merged = mergeThread([], live);
    expect(merged).toEqual(live);
    expect(merged).not.toBe(live);
  });

  it("keeps a draft last after the fold", () => {
    const merged = mergeThread<ThreadOrder>(
      [{ id: "old", at: 1, seq: 1 }],
      [{ id: "__draft__", at: 0, kind: "draft" }, { id: "new", at: 2, seq: 2 }],
    );
    expect(merged.map((m) => m.id)).toEqual(["old", "new", "__draft__"]);
  });

  it("reads the cursor off the highest mailbox seq and ignores unstamped bubbles", () => {
    const thread: ThreadOrder[] = [
      { id: "b", at: 20, seq: 2 },
      { id: "refused", at: 25 },
      { id: "a", at: 10, seq: 1 },
    ];
    expect(cursorOf(thread)).toEqual({ id: "b", seq: 2 });
    expect(ackSince(cursorOf(thread))).toBe("2");
    expect(cursorOf([{ id: "refused", at: 25 }])).toEqual({ seq: 0 });
    expect(ackSince(cursorOf([]))).toBeUndefined();
  });
});

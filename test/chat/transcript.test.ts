import { describe, expect, it } from "vitest";
import { TRANSCRIPT_MAX } from "@/lib/chat/caps";
import { utf8Bytes } from "@/lib/chat/caps";
import {
  appendTranscript,
  asTranscript,
  hydrateTranscript,
  shouldTranscript,
  transcriptStoreKey,
  TRANSCRIPT_BROADCAST,
  TRANSCRIPT_STORE_PREFIX,
} from "@/lib/chat/transcript";
import type { Queued } from "@/lib/chat/queue";

function msg(over: Partial<Queued> = {}): Queued {
  const base: Queued = { id: "1", to: "phone", body: "{}", at: 1_000, bytes: 2 };
  const merged = { ...base, ...over };
  return { ...merged, bytes: over.bytes ?? utf8Bytes(merged.body) };
}

describe("transcript", () => {
  it("stores bubbles only", () => {
    expect(shouldTranscript("inbound")).toBe(true);
    expect(shouldTranscript("reply")).toBe(true);
    expect(shouldTranscript("push")).toBe(true);
    expect(shouldTranscript("error")).toBe(false);
    expect(shouldTranscript("pin")).toBe(false);
    expect(shouldTranscript("ack")).toBe(false);
    expect(shouldTranscript("typing")).toBe(false);
    expect(shouldTranscript("draft")).toBe(false);
  });

  it("names keys per sub and a broadcast bucket", () => {
    expect(transcriptStoreKey("ada")).toBe(`${TRANSCRIPT_STORE_PREFIX}ada`);
    expect(transcriptStoreKey("")).toBe(`${TRANSCRIPT_STORE_PREFIX}${TRANSCRIPT_BROADCAST}`);
    expect(transcriptStoreKey()).toBe(`${TRANSCRIPT_STORE_PREFIX}${TRANSCRIPT_BROADCAST}`);
  });

  it("caps length by dropping the oldest, including replies", () => {
    const items = Array.from({ length: TRANSCRIPT_MAX }, (_, i) => (
      msg({ id: String(i), at: i, seq: i + 1, kind: "reply" })
    ));
    const next = appendTranscript(items, msg({ id: "tail", at: 9_000, seq: 9_000, kind: "reply" }));
    expect(next).toHaveLength(TRANSCRIPT_MAX);
    expect(next[0]?.id).toBe("1");
    expect(next.at(-1)?.id).toBe("tail");
  });

  it("restamps the same id and evicts under a byte cap", () => {
    const first = appendTranscript([], msg({ id: "a", body: "hello", at: 1, seq: 1 }));
    const restamp = appendTranscript(first, msg({ id: "a", body: "hello!", at: 2, seq: 1 }));
    expect(restamp).toHaveLength(1);
    expect(restamp[0]?.body).toBe("hello!");
    const fat = appendTranscript(
      [msg({ id: "old", body: "xxxx", at: 1, seq: 1 })],
      msg({ id: "new", body: "yyyy", at: 2, seq: 2 }),
      { bytesMax: 6 },
    );
    expect(fat.map((m) => m.id)).toEqual(["new"]);
  });

  it("hydrates Ada plus broadcasts and hides Bob", () => {
    const ada = [
      msg({ id: "in", userId: "ada", kind: "inbound", seq: 1, at: 1 }),
      msg({ id: "r", userId: "ada", kind: "reply", seq: 3, at: 3 }),
    ];
    const all = [msg({ id: "ping", userId: "", kind: "push", seq: 2, at: 2 })];
    expect(hydrateTranscript(ada, all).map((m) => m.id)).toEqual(["in", "ping", "r"]);
    expect(hydrateTranscript([], all).map((m) => m.id)).toEqual(["ping"]);
  });

  it("survives ack of the unread queue — transcript is a copy", () => {
    const live = appendTranscript([], msg({ id: "r1", userId: "ada", kind: "reply", seq: 1, at: 1 }));
    expect(hydrateTranscript(live, []).map((m) => m.id)).toEqual(["r1"]);
  });

  it("drops junk storage rows", () => {
    expect(asTranscript(null)).toEqual([]);
    expect(asTranscript("nope")).toEqual([]);
    expect(asTranscript([{ id: "a" }])).toEqual([]);
    const ok = asTranscript([msg({ id: "a", seq: 2, at: 2 }), msg({ id: "b", seq: 1, at: 1 })]);
    expect(ok.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

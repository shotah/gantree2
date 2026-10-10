/** @vitest-environment jsdom */

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { kvDel, kvSet } from "@/app/lib/kv";
import { loadThread, saveThread, threadCacheKey } from "@/app/lib/threadStore";

const used: string[] = [];

function key(slug: string, sub?: string) {
  const k = threadCacheKey(slug, sub);
  used.push(k);
  return k;
}

afterEach(async () => {
  await Promise.all(used.splice(0).map((k) => kvDel(k)));
});

describe("threadCacheKey", () => {
  it("separates rooms and humans; spike has no sub", () => {
    expect(threadCacheKey("kit", "1182")).toBe("thread:kit:1182");
    expect(threadCacheKey("ada", "1182")).not.toBe(threadCacheKey("kit", "1182"));
    expect(threadCacheKey("kit", "1182")).not.toBe(threadCacheKey("kit", "9"));
    expect(threadCacheKey("kit")).toBe("thread:kit:");
  });
});

describe("loadThread / saveThread", () => {
  it("round-trips bubbles including a photo data URL", async () => {
    const k = key("kit", "1182");
    const thread = [
      { id: "a", from: "you" as const, text: "this hatch?", at: 10, seq: 1, kind: "inbound", photo: "data:image/jpeg;base64,/9j/" },
      { id: "b", from: "kit" as const, text: "latched", at: 20, seq: 2, kind: "reply" },
    ];
    await saveThread(k, thread);
    expect(await loadThread(k)).toEqual(thread);
  });

  it("reads a missing row as an empty thread", async () => {
    expect(await loadThread(key("nobody"))).toEqual([]);
  });

  it("drops junk elements and junk rows instead of throwing", async () => {
    const k = key("kit", "junk");
    await kvSet(k, [
      { id: "ok", from: "kit", text: "hi", at: 1 },
      { id: "", from: "kit", text: "no id", at: 2 },
      { id: "x", from: "them", text: "bad from", at: 3 },
      { id: "y", from: "you", at: 4 },
      { id: "z", from: "you", text: "bad at", at: "4" },
      null,
      "string",
    ]);
    expect((await loadThread(k)).map((m) => m.id)).toEqual(["ok"]);
    const row = key("kit", "row");
    await kvSet(row, { not: "an array" });
    expect(await loadThread(row)).toEqual([]);
  });
});

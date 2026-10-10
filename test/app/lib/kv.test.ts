/** @vitest-environment jsdom */

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { kvDel, kvGet, kvSet } from "@/app/lib/kv";

describe("kv", () => {
  it("round-trips a structured value and forgets it on del", async () => {
    const key = `t:${Math.random()}`;
    expect(await kvGet(key)).toBeUndefined();
    await kvSet(key, { rev: "7", n: [1, 2] });
    expect(await kvGet(key)).toEqual({ rev: "7", n: [1, 2] });
    await kvDel(key);
    expect(await kvGet(key)).toBeUndefined();
  });

  it("keeps binary bytes", async () => {
    const key = `b:${Math.random()}`;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]).buffer;
    await kvSet(key, { rev: "1", bytes });
    const hit = await kvGet<{ rev: string; bytes: ArrayBuffer }>(key);
    expect(hit?.rev).toBe("1");
    expect(Array.from(new Uint8Array(hit?.bytes ?? new ArrayBuffer(0)))).toEqual([0xff, 0xd8, 0xff, 0x00]);
    await kvDel(key);
  });
});

/** @vitest-environment jsdom */

import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobCacheKey, useBlobUrl, type CachedBlob } from "@/app/lib/blobUrl";
import { kvDel, kvGet, kvSet } from "@/app/lib/kv";

const create = vi.fn<(b: Blob) => string>();
const revoke = vi.fn<(u: string) => void>();

beforeEach(() => {
  let n = 0;
  create.mockReset().mockImplementation(() => `blob:${++n}`);
  revoke.mockReset();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  await kvDel(blobCacheKey("avatar", "kit"));
  await kvDel(blobCacheKey("backdrop", "kit"));
});

type Call = { url: string; ifNoneMatch: string | null };

function stubFetch(status: number, rev = 7) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), ifNoneMatch: new Headers(init?.headers).get("If-None-Match") });
    // Bytes, not a jsdom Blob: Node's Response cannot stream jsdom's Blob.
    if (status === 200) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status,
        headers: { "Content-Type": "image/jpeg", "X-Chat-Rev": String(rev), ETag: `"${rev}"` },
      });
    }
    return new Response(null, { status, headers: status === 304 ? { "X-Chat-Rev": String(rev) } : {} });
  });
  return calls;
}

function seedCache(kind: "avatar" | "backdrop", rev: number) {
  return kvSet(blobCacheKey(kind, "kit"), {
    rev,
    type: "image/jpeg",
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]).buffer,
  } satisfies CachedBlob);
}

describe("useBlobUrl", () => {
  it("stays on the fallback with no path and never fetches", async () => {
    const calls = stubFetch(200);
    const { result } = renderHook(() => useBlobUrl(null, "/icon.svg"));
    expect(result.current).toBe("/icon.svg");
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it("turns a 200 into an object URL and revokes it on unmount", async () => {
    const calls = stubFetch(200);
    const { result, unmount } = renderHook(() => useBlobUrl("/api/chat/backdrop?slug=kit&v=7"));
    await waitFor(() => expect(result.current).toBe("blob:1"));
    expect(calls.map((c) => c.url)).toEqual(["/api/chat/backdrop?slug=kit&v=7"]);
    expect(calls[0]?.ifNoneMatch).toBeNull();
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:1");
  });

  it("falls back on a 404 and refetches when the path changes", async () => {
    const calls = stubFetch(404);
    const { result, rerender } = renderHook(({ path }: { path: string | null }) => useBlobUrl(path, "/icon.svg"), {
      initialProps: { path: "/api/chat/backdrop?slug=kit" },
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current).toBe("/icon.svg");
    rerender({ path: "/api/chat/backdrop?slug=kit&v=9" });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.url).toBe("/api/chat/backdrop?slug=kit&v=9");
  });

  it("falls back when fetch throws", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const { result } = renderHook(() => useBlobUrl("/api/chat/avatar?slug=kit", "/icon.svg"));
    await waitFor(() => expect(result.current).toBe("/icon.svg"));
  });

  it("does not touch the cache without a key", async () => {
    stubFetch(200);
    const { result } = renderHook(() => useBlobUrl("/api/chat/avatar?slug=kit", "/icon.svg"));
    await waitFor(() => expect(result.current).toBe("blob:1"));
    expect(await kvGet(blobCacheKey("avatar", "kit"))).toBeUndefined();
  });

  describe("with a cache key", () => {
    const key = blobCacheKey("avatar", "kit");

    it("stores a 200 with its rev so the next load has it", async () => {
      stubFetch(200, 7);
      const { result } = renderHook(() => useBlobUrl("/api/chat/avatar?slug=kit", "/icon.svg", key));
      await waitFor(() => expect(result.current).toBe("blob:1"));
      await waitFor(async () => {
        const hit = await kvGet<CachedBlob>(key);
        expect(hit?.rev).toBe(7);
        expect(hit?.type).toBe("image/jpeg");
        expect(new Uint8Array(hit?.bytes ?? new ArrayBuffer(0))).toHaveLength(3);
      });
    });

    it("paints the cached bytes first, then keeps them on a 304", async () => {
      await seedCache("avatar", 7);
      const calls = stubFetch(304, 7);
      const { result } = renderHook(() => useBlobUrl("/api/chat/avatar?slug=kit", "/icon.svg", key));
      await waitFor(() => expect(result.current).toBe("blob:1"));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]?.ifNoneMatch).toBe("\"7\"");
      await Promise.resolve();
      expect(result.current).toBe("blob:1");
      expect(create).toHaveBeenCalledTimes(1);
      expect(revoke).not.toHaveBeenCalled();
    });

    it("swaps to the new bytes when the room changed the picture", async () => {
      await seedCache("avatar", 7);
      stubFetch(200, 9);
      const { result } = renderHook(() => useBlobUrl("/api/chat/avatar?slug=kit&v=9", "/icon.svg", key));
      await waitFor(() => expect(result.current).toBe("blob:2"));
      // blob:1 was the cached paint; the fresh JPEG replaced it.
      expect(create).toHaveBeenCalledTimes(2);
      expect(revoke).toHaveBeenCalledWith("blob:1");
      await waitFor(async () => {
        expect((await kvGet<CachedBlob>(key))?.rev).toBe(9);
      });
    });

    it("drops the row and falls back when the blob was cleared", async () => {
      await seedCache("backdrop", 7);
      const bkey = blobCacheKey("backdrop", "kit");
      stubFetch(404);
      const { result } = renderHook(() => useBlobUrl("/api/chat/backdrop?slug=kit", "", bkey));
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:1"));
      // blob:1 was the cached wallpaper; the 404 took it down.
      expect(create).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(result.current).toBe(""));
      await waitFor(async () => {
        expect(await kvGet(bkey)).toBeUndefined();
      });
    });

    it("keeps the cached paint when the network is gone", async () => {
      await seedCache("avatar", 7);
      vi.stubGlobal("fetch", async () => {
        throw new Error("offline");
      });
      const { result } = renderHook(() => useBlobUrl("/api/chat/avatar?slug=kit", "/icon.svg", key));
      await waitFor(() => expect(result.current).toBe("blob:1"));
      await Promise.resolve();
      await Promise.resolve();
      expect(result.current).toBe("blob:1");
    });
  });
});

import { useEffect, useState } from "react";
import { blobEtag } from "@/lib/avatar/http";
import { kvDel, kvGet, kvSet } from "./kv";

/** What the last 200 left on the device: bytes plus the rev that names them. */
export type CachedBlob = { rev: number; type: string; bytes: ArrayBuffer };

/** One row per room blob. No rev, secret, or bearer in the key. */
export function blobCacheKey(kind: "avatar" | "backdrop", slug: string): string {
  return `look:${kind}:${slug}`;
}

function revFromHeaders(res: Response): number | null {
  const n = Number(res.headers.get("X-Chat-Rev"));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Same-origin fetch → object URL, revoked when `path` changes or on unmount.
 * Null `path`, a non-2xx, or a thrown fetch all land on `fallback`.
 *
 * With `cacheKey`, the last bytes paint from IndexedDB before the network
 * answers, and the fetch carries `If-None-Match` so an unchanged blob is an
 * empty 304 instead of the JPEG again. A 404 (cleared) drops the row; a
 * failed fetch keeps the cached paint.
 */
export function useBlobUrl(path: string | null, fallback = "", cacheKey?: string): string {
  const [src, setSrc] = useState(fallback);

  useEffect(() => {
    if (!path) {
      setSrc(fallback);
      return;
    }
    let dead = false;
    let obj = "";
    const drop = () => {
      if (obj) {
        URL.revokeObjectURL(obj);
        obj = "";
      }
    };
    const paint = (blob: Blob) => {
      drop();
      obj = URL.createObjectURL(blob);
      setSrc(obj);
    };
    void (async () => {
      const cached = cacheKey ? await kvGet<CachedBlob>(cacheKey) : undefined;
      if (dead) {
        return;
      }
      if (cached) {
        paint(new Blob([cached.bytes], { type: cached.type }));
      }
      try {
        const res = await fetch(path, {
          credentials: "include",
          headers: cached ? { "If-None-Match": blobEtag(cached.rev) } : undefined,
        });
        if (dead) {
          return;
        }
        if (res.status === 304 && cached) {
          return;
        }
        if (!res.ok) {
          if (cacheKey) {
            void kvDel(cacheKey);
          }
          drop();
          setSrc(fallback);
          return;
        }
        const bytes = await res.arrayBuffer();
        if (dead) {
          return;
        }
        const type = res.headers.get("Content-Type") ?? "image/jpeg";
        paint(new Blob([bytes], { type }));
        const rev = revFromHeaders(res);
        if (cacheKey && rev) {
          void kvSet(cacheKey, { rev, type, bytes } satisfies CachedBlob);
        }
      } catch {
        if (!dead && !cached) {
          setSrc(fallback);
        }
      }
    })();
    return () => {
      dead = true;
      drop();
    };
  }, [path, fallback, cacheKey]);

  return src;
}

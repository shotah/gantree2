"use client";

import { blobCacheKey, useBlobUrl } from "@/app/lib/blobUrl";
import { backdropRequestPath } from "@/lib/backdrop/http";

/**
 * Kit's wallpaper behind the thread. Absolute inside a `relative` parent;
 * bubbles are opaque, so only the gutter shows it. 404 (none / cleared) paints nothing.
 * The last wallpaper paints from IndexedDB before the fetch lands.
 */
export function Backdrop({
  slug,
  rev,
  secret,
  bearer,
}: {
  slug: string;
  rev: number;
  secret?: string;
  bearer?: string;
}) {
  const src = useBlobUrl(
    slug ? backdropRequestPath({ slug, rev, secret, bearer }) : null,
    "",
    slug ? blobCacheKey("backdrop", slug) : undefined,
  );
  if (!src) {
    return null;
  }
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <img src={src} alt="" className="h-full w-full object-cover opacity-60" />
    </div>
  );
}

import { blobRequestPath, type BlobRequestOpts } from "@/lib/avatar/path";

/**
 * `/api/chat/backdrop?slug=kit&v=<rev>` — relative, for same-origin fetch.
 * Pure: the browser imports this; the handler in `./http` must not leak in.
 */
export function backdropRequestPath(opts: BlobRequestOpts): string {
  return blobRequestPath("/api/chat/backdrop", opts);
}

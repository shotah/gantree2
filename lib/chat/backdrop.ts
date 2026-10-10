import { acceptJpeg } from "./jpeg";

/** Chat wallpaper. One JPEG per slug on the Agent DO, same shape as the face. */

export const BACKDROP_STORE_KEY = "backdrop";
/** SQLite-backed Durable Object rows cap at 2 MB (key + value). */
export const BACKDROP_MAX_BYTES = 1_500_000;
export const BACKDROP_TOO_LARGE = "image too large (max 1.5MB)";

export type StoredBackdrop = { jpeg: ArrayBuffer; rev: number };

export function packBackdrop(
  bytes: Uint8Array,
  now: number,
): { ok: true; stored: StoredBackdrop } | { ok: false; detail: string } {
  if (bytes.byteLength > BACKDROP_MAX_BYTES) {
    return { ok: false, detail: BACKDROP_TOO_LARGE };
  }
  const check = acceptJpeg(bytes);
  if (!check.ok) {
    return check;
  }
  const jpeg = new Uint8Array(bytes.byteLength);
  jpeg.set(bytes);
  return { ok: true, stored: { jpeg: jpeg.buffer, rev: now } };
}

/**
 * Room → every socket when the backdrop changes. `rev` 0 means cleared.
 * No `text` on purpose: a mouth that predates this kind drops a frame with
 * no text and no photo instead of painting the rev as a bubble.
 */
export function encodeBackdropNotice(rev: number): string {
  return JSON.stringify({ kind: "backdrop", rev });
}

import { acceptJpeg } from "../avatar/jpeg";

/** Chat wallpaper behind the thread. Same shape as the face: one JPEG per slug on the Durable Object. */

export const BACKDROP_STORE_KEY = "backdrop";
/** SQLite-backed Durable Object rows cap at 2 MB (key + value). Same budget as one chat photo. */
export const BACKDROP_MAX_BYTES = 1_500_000;
/** Long edge a writer should encode to. Phones cover-fit, so aspect is free. */
export const BACKDROP_EDGE = 1600;
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
 * Mailbox → every socket when the backdrop changes. `rev` 0 means cleared.
 * No `text` on purpose: a mouth that predates this kind drops a frame with
 * no text and no photo instead of painting the rev as a bubble.
 */
export function encodeBackdropNotice(rev: number): string {
  return JSON.stringify({ kind: "backdrop", rev });
}

/** `rev` (0 = cleared) from an incoming frame, or null when it is not a backdrop notice. */
export function backdropRevFromUnknown(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "backdrop" || typeof o.rev !== "number") {
    return null;
  }
  return Number.isSafeInteger(o.rev) && o.rev >= 0 ? o.rev : null;
}

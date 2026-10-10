/** Same JPEG gate the face and the backdrop share. */

export const JPEG_MAX_BYTES = 5 * 1024 * 1024;

export function acceptJpeg(bytes: Uint8Array): { ok: true } | { ok: false; detail: string } {
  if (bytes.byteLength < 32) {
    return { ok: false, detail: "image too small" };
  }
  if (bytes.byteLength > JPEG_MAX_BYTES) {
    return { ok: false, detail: "image too large (max 5MB)" };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, detail: "need a JPEG (the console converts PNG/WebP on upload)" };
  }
  return { ok: true };
}

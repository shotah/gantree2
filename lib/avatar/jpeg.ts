/** Same JPEG gate as gantree `lib/yard/host/avatar.ts`. */

export const AVATAR_FILE = "avatar.jpg";
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_EDGE = 1280;

export function acceptJpeg(bytes: Uint8Array): { ok: true } | { ok: false; detail: string } {
  if (bytes.byteLength < 32) {
    return { ok: false, detail: "image too small" };
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, detail: "image too large (max 5MB)" };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, detail: "need a JPEG (the console converts PNG/WebP on upload)" };
  }
  return { ok: true };
}

export function shouldPassthroughJpeg(opts: {
  type: string;
  size: number;
  width: number;
  height: number;
  edge?: number;
  maxBytes?: number;
}): boolean {
  const limit = opts.edge ?? AVATAR_EDGE;
  const maxBytes = opts.maxBytes ?? AVATAR_MAX_BYTES;
  const edge = Math.max(opts.width, opts.height);
  const scale = Math.min(1, limit / Math.max(1, edge));
  return opts.type === "image/jpeg" && scale === 1 && opts.size <= maxBytes;
}

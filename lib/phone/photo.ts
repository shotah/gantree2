import { IMAGE_BYTES_MAX } from "../chat/caps";

/** Chat photos: smaller than avatar face edge; still under IMAGE_BYTES_MAX after encode. */
export const CHAT_PHOTO_EDGE = 1600;

/**
 * Settings → Photo size. Long edge in px. Vision models bill by pixel area (~w·h/750 tokens)
 * and clamp near 1 MP, so Full mostly buys wire bytes, not detail. Cab mirrors this table.
 */
export const PHOTO_SIZES = [
  { id: "full", label: "Full", edge: CHAT_PHOTO_EDGE },
  { id: "medium", label: "Medium", edge: 1024 },
  { id: "small", label: "Small", edge: 640 },
] as const;

export type PhotoSizeId = (typeof PHOTO_SIZES)[number]["id"];

export const DEFAULT_PHOTO_SIZE: PhotoSizeId = "medium";

const PHOTO_SIZE_IDS: readonly string[] = PHOTO_SIZES.map((s) => s.id);

export function parsePhotoSize(v: unknown): PhotoSizeId {
  return typeof v === "string" && PHOTO_SIZE_IDS.includes(v) ? (v as PhotoSizeId) : DEFAULT_PHOTO_SIZE;
}

export function photoEdge(id: PhotoSizeId): number {
  return (PHOTO_SIZES.find((s) => s.id === id) ?? PHOTO_SIZES[1]).edge;
}
/**
 * Raw JPEG budget. The mailbox measures the base64 data URL (`utf8Bytes(url)`), which is
 * 4/3 of the bytes plus the `data:image/jpeg;base64,` prefix — so encode to this, not IMAGE_BYTES_MAX.
 */
export const PHOTO_JPEG_BYTES_MAX = Math.floor((IMAGE_BYTES_MAX - 32) / 4) * 3;

export type PhotoOk = { ok: true; url: string };
export type PhotoErr = { ok: false; error: "too large" | "bad photo" };
export type PhotoResult = PhotoOk | PhotoErr;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function photoDataUrl(opts: { mime: string; bytes: Uint8Array }): PhotoResult {
  const mime = opts.mime.toLowerCase() === "image/jpg" ? "image/jpeg" : opts.mime.toLowerCase();
  if (!ALLOWED.has(mime)) {
    return { ok: false, error: "bad photo" };
  }
  if (opts.bytes.byteLength === 0 || opts.bytes.byteLength > PHOTO_JPEG_BYTES_MAX) {
    return { ok: false, error: opts.bytes.byteLength === 0 ? "bad photo" : "too large" };
  }
  const b64 = bytesToB64(opts.bytes);
  return { ok: true, url: `data:${mime};base64,${b64}` };
}

export function parsePhotoFile(file: { type: string; size: number }): PhotoErr | { ok: true } {
  const mime = file.type.toLowerCase();
  if (!ALLOWED.has(mime)) {
    return { ok: false, error: "bad photo" };
  }
  if (file.size <= 0 || file.size > IMAGE_BYTES_MAX) {
    return { ok: false, error: file.size <= 0 ? "bad photo" : "too large" };
  }
  return { ok: true };
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

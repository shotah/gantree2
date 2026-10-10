import { acceptJpeg } from "./jpeg";
export { displaySlug } from "./slug";

export const AVATAR_STORE_KEY = "avatar";

export type StoredAvatar = { jpeg: ArrayBuffer; rev: number };

export function packAvatar(
  bytes: Uint8Array,
  now: number,
): { ok: true; stored: StoredAvatar } | { ok: false; detail: string } {
  const check = acceptJpeg(bytes);
  if (!check.ok) {
    return check;
  }
  const jpeg = new Uint8Array(bytes.byteLength);
  jpeg.set(bytes);
  return { ok: true, stored: { jpeg: jpeg.buffer, rev: now } };
}

/** `{ kind: "face", text: "<rev>" }` — the wire the phones already paint. */
export function encodeFaceNotice(rev: number): string {
  return JSON.stringify({ kind: "face", text: String(rev) });
}

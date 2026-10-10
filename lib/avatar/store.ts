import { acceptJpeg } from "./jpeg";

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

export function encodeFaceNotice(rev: number): string {
  return JSON.stringify({ kind: "face", text: String(rev) });
}

export function faceRevFromUnknown(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "face" || typeof o.text !== "string") {
    return null;
  }
  const n = Number(o.text);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function displaySlug(slug: string): string {
  const s = slug.trim();
  if (!s) {
    return "Kit";
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

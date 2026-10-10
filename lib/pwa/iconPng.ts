/** Committed PWA rasters. `npm run icons` paints these from `public/icon.svg`. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PWA_ICON_FILES = {
  "icon-192.png": { width: 192, height: 192 },
  "icon-512.png": { width: 512, height: 512 },
  "icon-maskable-512.png": { width: 512, height: 512 },
  "apple-touch-icon.png": { width: 180, height: 180 },
} as const;

export type PwaIconName = keyof typeof PWA_ICON_FILES;

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Bytes of a committed icon. `dir` defaults to `public/` from the process cwd. */
export function readPwaIcon(name: PwaIconName, dir = "public"): Uint8Array {
  return new Uint8Array(readFileSync(join(dir, name)));
}

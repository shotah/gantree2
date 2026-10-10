import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pngSize, PWA_ICON_FILES, readPwaIcon, type PwaIconName } from "@/lib/pwa/iconPng";

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

describe("iconPng", () => {
  it("reads the committed pngs at Chrome's sizes", () => {
    for (const name of Object.keys(PWA_ICON_FILES) as PwaIconName[]) {
      const bytes = readPwaIcon(name);
      expect(pngSize(bytes)).toEqual(PWA_ICON_FILES[name]);
      const disk = Uint8Array.from(readFileSync(`public/${name}`) as ArrayLike<number>);
      expect(same(bytes, disk)).toBe(true);
    }
  });

  it("rejects a buffer that is not a png", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngSize(new Uint8Array(16))).toBeNull();
  });
});

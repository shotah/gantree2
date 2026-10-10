import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pngSize, PWA_ICON_FILES, readPwaIcon, type PwaIconName } from "@/lib/pwa/iconPng";

describe("iconPng", () => {
  it("reads the committed pngs at Chrome's sizes", () => {
    for (const name of Object.keys(PWA_ICON_FILES) as PwaIconName[]) {
      const bytes = readPwaIcon(name);
      expect(pngSize(bytes)).toEqual(PWA_ICON_FILES[name]);
      expect(Buffer.from(readFileSync(`public/${name}`)).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it("rejects a buffer that is not a png", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngSize(new Uint8Array(16))).toBeNull();
  });
});

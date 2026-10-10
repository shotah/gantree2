import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pngSize } from "@/lib/pwa/iconPng";
import { generateIcons } from "../../scripts/icons.ts";

const PNG_SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

const PNGS = [
  ["public/icon-192.png", 192, 192],
  ["public/icon-512.png", 512, 512],
  ["public/icon-maskable-512.png", 512, 512],
  ["public/apple-touch-icon.png", 180, 180],
  ["assets/banner.png", 1280, 400],
] as const;

function readBytes(path: string): Uint8Array {
  return Uint8Array.from(readFileSync(path) as ArrayLike<number>);
}

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

function startsWith(bytes: Uint8Array, sig: Uint8Array): boolean {
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) {
      return false;
    }
  }
  return true;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 16777216) + (bytes[offset + 1] * 65536) + (bytes[offset + 2] * 256) + bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(bytes[offset + i]);
  }
  return text;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

/** True when colour type is RGB, or RGBA with every alpha sample at 255. */
function pngIsOpaque(bytes: Uint8Array): boolean {
  const colorType = bytes[25];
  if (colorType === 2) {
    return true;
  }
  if (colorType !== 6 || bytes[24] !== 8) {
    return false;
  }
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const len = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = u32be(data, 0);
      height = u32be(data, 4);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of idat) {
    joined.set(part, at);
    at += part.length;
  }
  const raw = Uint8Array.from(inflateSync(joined) as ArrayLike<number>);
  const stride = width * 4;
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p];
    p += 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = prev[i];
      const ul = i >= 4 ? prev[i - 4] : 0;
      const v = raw[p + i];
      if (filter === 0) {
        row[i] = v;
      } else if (filter === 1) {
        row[i] = (v + left) & 255;
      } else if (filter === 2) {
        row[i] = (v + up) & 255;
      } else if (filter === 3) {
        row[i] = (v + Math.floor((left + up) / 2)) & 255;
      } else if (filter === 4) {
        row[i] = (v + paeth(left, up, ul)) & 255;
      } else {
        throw new Error(`png filter ${filter}`);
      }
    }
    p += stride;
    for (let x = 3; x < stride; x += 4) {
      if (row[x] !== 255) {
        return false;
      }
    }
    prev.set(row);
  }
  return true;
}

describe("generateIcons", () => {
  const dir = mkdtempSync(join(tmpdir(), "gantree-icons-"));
  const files = generateIcons(dir);
  const first = files.map((file) => readBytes(file));

  it("writes each ship png with a signature and IHDR size", () => {
    expect(files.map((file) => file.slice(dir.length + 1))).toEqual([
      ...PNGS.map(([name]) => name),
      "app/favicon.ico",
    ]);
    for (const [name, width, height] of PNGS) {
      const bytes = readBytes(join(dir, name));
      expect(startsWith(bytes, PNG_SIG)).toBe(true);
      expect(pngSize(bytes)).toEqual({ width, height });
    }
    const apple = readBytes(join(dir, "public/apple-touch-icon.png"));
    expect([2, 6]).toContain(apple[25]);
    expect(pngIsOpaque(apple)).toBe(true);
  });

  it("repeats byte for byte", () => {
    const again = generateIcons(dir);
    expect(again).toEqual(files);
    again.forEach((file, i) => {
      expect(same(readBytes(file), first[i])).toBe(true);
    });
  });
});

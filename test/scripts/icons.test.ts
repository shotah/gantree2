import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pngSize } from "@/lib/pwa/iconPng";
import { generateIcons } from "../../scripts/icons.ts";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const PNGS = [
  ["public/icon-192.png", 192, 192],
  ["public/icon-512.png", 512, 512],
  ["public/icon-maskable-512.png", 512, 512],
  ["public/apple-touch-icon.png", 180, 180],
  ["assets/banner.png", 1280, 400],
] as const;

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
function pngIsOpaque(bytes: Buffer): boolean {
  const colorType = bytes[25];
  if (colorType === 2) {
    return true;
  }
  if (colorType !== 6 || bytes[24] !== 8) {
    return false;
  }
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
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
  const first = files.map((file) => readFileSync(file));

  it("writes each ship png with a signature and IHDR size", () => {
    expect(files.map((file) => file.slice(dir.length + 1))).toEqual([
      ...PNGS.map(([name]) => name),
      "app/favicon.ico",
    ]);
    for (const [name, width, height] of PNGS) {
      const bytes = readFileSync(join(dir, name));
      expect(bytes.subarray(0, 8).equals(PNG_SIG)).toBe(true);
      expect(pngSize(bytes)).toEqual({ width, height });
    }
    const apple = readFileSync(join(dir, "public/apple-touch-icon.png"));
    expect([2, 6]).toContain(apple[25]);
    expect(pngIsOpaque(apple)).toBe(true);
  });

  it("repeats byte for byte", () => {
    const again = generateIcons(dir);
    expect(again).toEqual(files);
    again.forEach((file, i) => {
      expect(Buffer.from(readFileSync(file)).equals(first[i])).toBe(true);
    });
  });
});

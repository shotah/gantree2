#!/usr/bin/env node
/**
 * Rasterise the gantree mark.
 *
 *   node scripts/icons.ts [--apps] [--out=dir]
 *
 * Writes public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png,
 * public/apple-touch-icon.png, assets/banner.png, and app/favicon.ico under
 * `out` (default: this repo). `--apps` also writes Android mipmaps and iOS
 * AppIcon PNGs into the sister brand directory.
 *
 * Banner text is DejaVu Sans (the box has no 600 face, so weight 600 resolves
 * to DejaVu Sans Bold). Favicon ink is Paper fg `#1c1814` baked into the mono mark.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

export const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The apps repo sits beside this one; `generateIcons(out, { appsDir })` overrides. */
export const APPS_BRAND = join(REPO_ROOT, "..", "gantree2-apps", "shared", "brand");

const CANVAS = "#0e1316";
const FAVICON_INK = "#1c1814";

const FONT_NAMES = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"] as const;

/** Where distros put DejaVu: Arch/SteamOS, Debian/Ubuntu (CI runners), Fedora. `GANTREE_FONT_DIR` wins. */
export const FONT_DIRS = [
  "/usr/share/fonts/TTF",
  "/usr/share/fonts/truetype/dejavu",
  "/usr/share/fonts/dejavu-sans-fonts",
  "/usr/share/fonts/dejavu",
] as const;

/** The first directory holding both faces, or `null`. */
export function fontDir(dirs: readonly string[] = FONT_DIRS, exists: (file: string) => boolean = existsSync): string | null {
  for (const dir of dirs) {
    if (FONT_NAMES.every((name) => exists(join(dir, name)))) {
      return dir;
    }
  }
  return null;
}

function fontFiles(): string[] {
  const override = process.env.GANTREE_FONT_DIR;
  const dir = fontDir(override ? [override, ...FONT_DIRS] : FONT_DIRS);
  if (!dir) {
    throw new Error(`missing font DejaVu Sans: looked in ${FONT_DIRS.join(", ")}; set GANTREE_FONT_DIR or install fonts-dejavu-core`);
  }
  return FONT_NAMES.map((name) => join(dir, name));
}

const ANDROID = [
  ["mipmap-mdpi/ic_launcher.png", 48],
  ["mipmap-hdpi/ic_launcher.png", 72],
  ["mipmap-xhdpi/ic_launcher.png", 96],
  ["mipmap-xxhdpi/ic_launcher.png", 144],
  ["mipmap-xxxhdpi/ic_launcher.png", 192],
  ["play-store.png", 512],
] as const;

const IOS_SIZES = [1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20] as const;

export type GenerateIconsOptions = {
  apps?: boolean;
  appsDir?: string;
};

function toBytes(data: ArrayLike<number>): Uint8Array {
  return Uint8Array.from(data);
}

function raster(svg: string, width: number, height: number, background?: string): Uint8Array {
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    shapeRendering: 2,
    textRendering: 1,
    font: {
      fontFiles: fontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans",
    },
    ...(background ? { background } : {}),
  }).render();
  if (image.width !== width || image.height !== height) {
    throw new Error(`raster ${image.width}x${image.height}, want ${width}x${height}`);
  }
  return toBytes(image.asPng());
}

/** Drop width/height on the root so the placed copy can take a new size. */
function placed(markSvg: string, x: number, y: number, size: number): string {
  return markSvg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, "");
    return `<svg x="${x}" y="${y}" width="${size}" height="${size}"${cleaned}>`;
  });
}

/** Mark on a Boom-canvas square. `pad` is the inset on each side (0 fills the square). */
function plate(markSvg: string, size: number, pad: number): string {
  const inner = size - 2 * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${CANVAS}"/>${placed(markSvg, pad, pad, inner)}</svg>`;
}

function write(path: string, data: Uint8Array): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

function writeU16(buf: Uint8Array, offset: number, n: number) {
  buf[offset] = n & 255;
  buf[offset + 1] = (n >> 8) & 255;
}

function writeU32(buf: Uint8Array, offset: number, n: number) {
  buf[offset] = n & 255;
  buf[offset + 1] = (n >> 8) & 255;
  buf[offset + 2] = (n >> 16) & 255;
  buf[offset + 3] = (n >> 24) & 255;
}

/** ICO directory (6 bytes) plus one 16-byte entry per image, then PNG payloads. */
function packIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = new Uint8Array(6 + 16 * images.length);
  writeU16(header, 2, 1);
  writeU16(header, 4, images.length);
  let offset = header.length;
  images.forEach((img, i) => {
    const entry = 6 + i * 16;
    const dim = img.size >= 256 ? 0 : img.size;
    header[entry] = dim;
    header[entry + 1] = dim;
    writeU16(header, entry + 4, 1);
    writeU16(header, entry + 6, 32);
    writeU32(header, entry + 8, img.png.length);
    writeU32(header, entry + 12, offset);
    offset += img.png.length;
  });
  const out = new Uint8Array(offset);
  out.set(header, 0);
  let cursor = header.length;
  for (const img of images) {
    out.set(img.png, cursor);
    cursor += img.png.length;
  }
  return out;
}

export function generateIcons(outDir: string, options: GenerateIconsOptions = {}): string[] {
  if (!outDir) {
    throw new Error("usage: icons.ts [--apps] [--out=dir]");
  }
  fontFiles();
  const logo = readFileSync(join(REPO_ROOT, "assets/logo.svg"), "utf8");
  const icon = readFileSync(join(REPO_ROOT, "public/icon.svg"), "utf8");
  const banner = readFileSync(join(REPO_ROOT, "assets/banner.svg"), "utf8");
  const mono = readFileSync(join(REPO_ROOT, "assets/logo-mono.svg"), "utf8").replaceAll("currentColor", FAVICON_INK);

  const written = [
    write(join(outDir, "public/icon-192.png"), raster(icon, 192, 192)),
    write(join(outDir, "public/icon-512.png"), raster(icon, 512, 512)),
    write(join(outDir, "public/icon-maskable-512.png"), raster(plate(logo, 512, 512 * 0.2), 512, 512, CANVAS)),
    write(join(outDir, "public/apple-touch-icon.png"), raster(plate(logo, 180, 0), 180, 180, CANVAS)),
    write(join(outDir, "assets/banner.png"), raster(banner, 1280, 400)),
    write(join(outDir, "app/favicon.ico"), packIco([16, 32, 48].map((size) => ({ size, png: raster(mono, size, size) })))),
  ];

  if (options.apps) {
    const brand = options.appsDir ?? APPS_BRAND;
    for (const [file, size] of ANDROID) {
      written.push(write(join(brand, "android", file), raster(plate(logo, size, 0), size, size, CANVAS)));
    }
    for (const size of IOS_SIZES) {
      written.push(write(join(brand, "ios", `AppIcon-${size}.png`), raster(plate(logo, size, 0), size, size, CANVAS)));
    }
  }
  return written;
}

export function main(argv: string[]): string[] {
  let outDir = REPO_ROOT;
  let apps = false;
  for (const arg of argv) {
    if (arg === "--apps") {
      apps = true;
    } else if (arg.startsWith("--out=")) {
      const dir = arg.slice("--out=".length);
      if (!dir) {
        throw new Error("usage: icons.ts [--apps] [--out=dir]");
      }
      outDir = dir;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return generateIcons(outDir, { apps });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    for (const file of main(process.argv.slice(2))) {
      process.stdout.write(`wrote ${file}\n`);
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

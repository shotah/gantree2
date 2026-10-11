import { decode, encode } from "jpeg-js";
import { decode as decodePng } from "fast-png";

export const avatarEdge = 1280;
export const backdropEdge = 1600;
export const avatarMaxBytes = 5 * 1024 * 1024;
export const backdropMaxBytes = 1_500_000;
export const jpegEdgeMin = 320;
const jpegEdgeStep = 0.75;
const jpegQualities = [90, 80, 70, 60];

export type Rgba = { data: Uint8Array; width: number; height: number };

export type JpegEncoder = (img: Rgba, quality: number) => Uint8Array;

const encodeTyped = encode as unknown as (img: { data: Uint8Array; width: number; height: number }, quality: number) => { data: Uint8Array };
const decodeTyped = decode as unknown as (data: Uint8Array, opts: { useTArray: true; formatAsRGBA: true }) => { data: Uint8Array; width: number; height: number };

function defaultEncode(img: Rgba, quality: number): Uint8Array {
  const encoded = encodeTyped(img, quality);
  return new Uint8Array(encoded.data);
}

let encoder: JpegEncoder = defaultEncode;

export function setJpegEncoder(next: JpegEncoder | null): void {
  encoder = next ?? defaultEncode;
}

export function fitSize(w: number, h: number, edge: number): [number, number] {
  let width = w < 1 ? 1 : w;
  let height = h < 1 ? 1 : h;
  const cap = edge < 1 ? 1 : edge;
  const long = Math.max(width, height);
  const scale = Math.min(1, cap / long);
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return [width, height];
}

export function isJpeg(raw: Uint8Array): boolean {
  return raw.byteLength >= 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;
}

export function decodeImage(raw: Uint8Array): Rgba {
  if (isPng(raw)) return pngToRgba(raw);
  if (isJpeg(raw)) return jpegToRgba(raw);
  throw new Error("could not read that image");
}

export function prepareJpeg(raw: Uint8Array, edge: number, maxBytes: number): { data: Uint8Array; edge: number } {
  if (isJpeg(raw)) {
    const img = jpegToRgba(raw);
    const long = Math.max(img.width, img.height);
    if (long <= edge && raw.byteLength <= maxBytes) return { data: raw, edge: long };
    return shrinkToJpeg(img, edge, maxBytes);
  }
  return shrinkToJpeg(decodeImage(raw), edge, maxBytes);
}

export function shrinkToJpeg(src: Rgba, edge: number, maxBytes: number): { data: Uint8Array; edge: number } {
  const long = Math.max(src.width, src.height);
  let target = Math.min(edge, long);
  if (target < 1) target = 1;
  for (;;) {
    const [fw, fh] = fitSize(src.width, src.height, target);
    const fitted = resize(src, fw, fh);
    for (const quality of jpegQualities) {
      let data: Uint8Array;
      try {
        data = encoder(fitted, quality);
      } catch {
        throw new Error("could not encode jpeg");
      }
      if (data.byteLength <= maxBytes) return { data, edge: target };
    }
    const next = Math.round(target * jpegEdgeStep);
    if (next < jpegEdgeMin) break;
    target = next;
  }
  throw new Error("image too large");
}

function resize(src: Rgba, w: number, h: number): Rgba {
  if (src.width === w && src.height === h) return src;
  const dst = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(src.height - 1, Math.round(((y + 0.5) * src.height) / h - 0.5));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(src.width - 1, Math.round(((x + 0.5) * src.width) / w - 0.5));
      const si = (Math.max(0, sy) * src.width + Math.max(0, sx)) * 4;
      const di = (y * w + x) * 4;
      dst[di] = src.data[si] ?? 0;
      dst[di + 1] = src.data[si + 1] ?? 0;
      dst[di + 2] = src.data[si + 2] ?? 0;
      dst[di + 3] = src.data[si + 3] ?? 255;
    }
  }
  return { data: dst, width: w, height: h };
}

function isPng(raw: Uint8Array): boolean {
  return raw.byteLength >= 8 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
}

function pngToRgba(raw: Uint8Array): Rgba {
  try {
    const png = decodePng(raw);
    return toRgba(png.data, png.width, png.height, png.channels);
  } catch {
    throw new Error("could not read that image");
  }
}

function jpegToRgba(raw: Uint8Array): Rgba {
  try {
    const img = decodeTyped(raw, { useTArray: true, formatAsRGBA: true });
    return { data: new Uint8Array(img.data), width: img.width, height: img.height };
  } catch {
    throw new Error("could not read that image");
  }
}

function toRgba(data: Uint8Array | Uint16Array | Uint8ClampedArray, width: number, height: number, channels: number): Rgba {
  const pixels = width * height;
  const rgba = new Uint8Array(pixels * 4);
  const src = data instanceof Uint16Array ? downshift(data) : data;
  if (channels === 4) {
    rgba.set(src.subarray(0, pixels * 4));
    return { data: rgba, width, height };
  }
  if (channels === 3) {
    for (let i = 0; i < pixels; i += 1) {
      rgba[i * 4] = src[i * 3] ?? 0;
      rgba[i * 4 + 1] = src[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = src[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    return { data: rgba, width, height };
  }
  for (let i = 0; i < pixels; i += 1) {
    const v = src[i] ?? 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { data: rgba, width, height };
}

function downshift(data: Uint16Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = (data[i] ?? 0) >> 8;
  return out;
}

import { AVATAR_EDGE, AVATAR_MAX_BYTES, shouldPassthroughJpeg } from "@/lib/avatar/jpeg";

export type JpegLimits = {
  edge?: number;
  maxBytes?: number;
};

/** Quality ladder per edge, then the edge shrinks by EDGE_STEP until EDGE_MIN. */
export const JPEG_QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6] as const;
export const JPEG_EDGE_STEP = 0.75;
export const JPEG_EDGE_MIN = 320;

function fitEdge(bitmap: { width: number; height: number }, edge: number): { w: number; h: number } {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  return {
    w: Math.max(1, Math.round(bitmap.width * scale)),
    h: Math.max(1, Math.round(bitmap.height * scale)),
  };
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Browser canvas → JPEG, same as gantree `app/lib/jpegFromFile.ts`, plus a shrink ladder for camera shots. */
export async function jpegFromFile(file: File, limits: JpegLimits = {}): Promise<Blob> {
  const edge = limits.edge ?? AVATAR_EDGE;
  const maxBytes = limits.maxBytes ?? AVATAR_MAX_BYTES;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("could not read that image");
  }
  try {
    if (shouldPassthroughJpeg({
      type: file.type,
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
      edge,
      maxBytes,
    })) {
      return file;
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("could not encode jpeg");
    }
    let target = Math.min(edge, Math.max(bitmap.width, bitmap.height));
    for (;;) {
      const { w, h } = fitEdge(bitmap, target);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of JPEG_QUALITY_STEPS) {
        const blob = await encode(canvas, quality);
        if (!blob) {
          throw new Error("could not encode jpeg");
        }
        if (blob.size <= maxBytes) {
          return blob;
        }
      }
      const next = Math.round(target * JPEG_EDGE_STEP);
      if (next < JPEG_EDGE_MIN) {
        break;
      }
      target = next;
    }
    throw new Error("image too large");
  } finally {
    bitmap.close();
  }
}

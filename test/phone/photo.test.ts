import { describe, expect, it } from "vitest";
import { IMAGE_BYTES_MAX, utf8Bytes } from "@/lib/chat/caps";
import { parseFrame } from "@/lib/chat/frame";
import {
  CHAT_PHOTO_EDGE,
  DEFAULT_PHOTO_SIZE,
  parsePhotoFile,
  parsePhotoSize,
  PHOTO_JPEG_BYTES_MAX,
  PHOTO_SIZES,
  photoDataUrl,
  photoEdge,
  type PhotoResult,
} from "@/lib/phone/photo";

function photoErr(r: PhotoResult | { ok: true } | { ok: false; error: string }): string {
  return r.ok ? "ok" : r.error;
}

describe("photo", () => {
  it("accepts a small jpeg as a data URL", () => {
    const got = photoDataUrl({ mime: "image/jpg", bytes: new Uint8Array([1, 2, 3]) });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    }
  });

  it("rejects empty, huge, and non-image types", () => {
    expect(photoErr(photoDataUrl({ mime: "image/jpeg", bytes: new Uint8Array() }))).toBe("bad photo");
    expect(photoErr(photoDataUrl({ mime: "text/plain", bytes: new Uint8Array([1]) }))).toBe("bad photo");
    expect(photoErr(photoDataUrl({ mime: "image/jpeg", bytes: new Uint8Array(IMAGE_BYTES_MAX + 1) }))).toBe("too large");
    expect(parsePhotoFile({ type: "image/png", size: 10 })).toEqual({ ok: true });
    expect(parsePhotoFile({ type: "application/pdf", size: 10 }).ok).toBe(false);
    expect(parsePhotoFile({ type: "image/jpeg", size: 0 }).ok).toBe(false);
    expect(photoErr(parsePhotoFile({ type: "image/jpeg", size: IMAGE_BYTES_MAX + 1 }))).toBe("too large");
  });

  it("budgets raw jpeg bytes so the data URL the mailbox measures fits IMAGE_BYTES_MAX", () => {
    expect(PHOTO_JPEG_BYTES_MAX).toBeLessThan(IMAGE_BYTES_MAX);
    const fat = photoDataUrl({ mime: "image/jpeg", bytes: new Uint8Array(PHOTO_JPEG_BYTES_MAX) });
    expect(fat.ok).toBe(true);
    if (fat.ok) {
      expect(utf8Bytes(fat.url)).toBeLessThanOrEqual(IMAGE_BYTES_MAX);
      const parsed = parseFrame(JSON.stringify({ kind: "inbound", images: [{ url: fat.url }] }), { role: "phone" });
      expect(parsed.ok).toBe(true);
    }
    expect(photoErr(photoDataUrl({ mime: "image/jpeg", bytes: new Uint8Array(PHOTO_JPEG_BYTES_MAX + 3) }))).toBe("too large");
  });

  it("offers full / medium / small long edges, medium by default, full being the old cap", () => {
    expect(PHOTO_SIZES.map((s) => s.id)).toEqual(["full", "medium", "small"]);
    expect(PHOTO_SIZES.map((s) => s.edge)).toEqual([1600, 1024, 640]);
    expect(DEFAULT_PHOTO_SIZE).toBe("medium");
    expect(photoEdge("full")).toBe(CHAT_PHOTO_EDGE);
    expect(photoEdge("small")).toBe(640);
    expect(parsePhotoSize("small")).toBe("small");
    expect(parsePhotoSize("huge")).toBe("medium");
    expect(parsePhotoSize(null)).toBe("medium");
    expect(parsePhotoSize(1600)).toBe("medium");
  });
});

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fileFromClipboard, fileToPhoto } from "@/app/lib/photo";
import { IMAGE_BYTES_MAX, utf8Bytes } from "@/lib/chat/caps";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fileFromClipboard", () => {
  it("returns the first image file and ignores empty or non-image pastes", () => {
    const img = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
    const jpeg = new File([new Uint8Array([2])], "a.jpg", { type: "image/jpeg" });
    const note = new File(["hi"], "a.txt", { type: "text/plain" });
    expect(fileFromClipboard({
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/png", getAsFile: () => img },
      ],
    })).toBe(img);
    expect(fileFromClipboard({ files: [note, jpeg] })).toBe(jpeg);
    expect(fileFromClipboard(null)).toBeNull();
    expect(fileFromClipboard({ items: [], files: [] })).toBeNull();
    expect(fileFromClipboard({
      items: [{ kind: "file", type: "image/png", getAsFile: () => new File([], "empty.png", { type: "image/png" }) }],
    })).toBeNull();
  });
});

describe("fileToPhoto", () => {
  it("rejects a non-image file", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("nope");
    });
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    expect((await fileToPhoto(file)).ok).toBe(false);
  });

  it("encodes a tiny jpeg", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });
    const got = await fileToPhoto(file);
    expect(got.ok).toBe(true);
  });

  it("converts heic when the bitmap decoder works", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb) {
      cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }));
    });
    const file = new File([new Uint8Array([1, 2, 3])], "a.heic", { type: "image/heic" });
    const got = await fileToPhoto(file);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    }
  });

  it("shrinks a camera shot until the data URL fits the wire", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4032, height: 3024, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    let encodes = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb, _type, quality) {
      encodes += 1;
      // First pass lands well over the budget; anything after fits.
      const size = encodes === 1 ? 3_000_000 : Math.round(this.width * Number(quality) * 100);
      cb(new Blob([new Uint8Array(size)], { type: "image/jpeg" }));
    });
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.jpg", { type: "image/jpeg" });
    const got = await fileToPhoto(file);
    expect(got.ok).toBe(true);
    expect(encodes).toBe(2);
    if (got.ok) {
      expect(utf8Bytes(got.url)).toBeLessThanOrEqual(IMAGE_BYTES_MAX);
    }
  });

  it("draws at the long edge Settings asked for", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4032, height: 3024, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const dims: [number, number][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb) {
      dims.push([this.width, this.height]);
      cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }));
    });
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_0001.jpg", { type: "image/jpeg" });
    expect((await fileToPhoto(file, { edge: 640 })).ok).toBe(true);
    expect(dims).toEqual([[640, 480]]);
  });

  it("maps an oversized encode to too large", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2000, height: 100, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb) {
      cb(new Blob([new Uint8Array(2_000_000)], { type: "image/jpeg" }));
    });
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    expect(await fileToPhoto(file)).toEqual({ ok: false, error: "too large" });
  });
});

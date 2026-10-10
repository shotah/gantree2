/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { jpegFromFile } from "@/app/lib/jpegFromFile";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jpegFile(over: Partial<{ type: string; size: number }> = {}): File {
  const bytes = new Uint8Array(64);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return new File([bytes], "a.jpg", { type: over.type ?? "image/jpeg" });
}

describe("jpegFromFile", () => {
  it("passes through a small jpeg", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    const file = jpegFile();
    expect(await jpegFromFile(file)).toBe(file);
  });

  it("rejects unreadables", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("nope");
    });
    await expect(jpegFromFile(jpegFile())).rejects.toThrow(/could not read/);
  });

  it("encodes a wide image down to jpeg", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2000, height: 100, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb) {
      cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }));
    });
    const blob = await jpegFromFile(jpegFile({ type: "image/png" }), { edge: 1600, maxBytes: 1_500_000 });
    expect(blob.type).toBe("image/jpeg");
  });

  it("fails when the canvas cannot encode", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 2000, height: 100, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(jpegFromFile(jpegFile({ type: "image/png" }))).rejects.toThrow(/encode/);
  });

  it("steps quality down, then the edge, until the jpeg fits the budget", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const tries: { w: number; q: number }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb, _type, quality) {
      const q = Number(quality);
      tries.push({ w: this.width, q });
      // A camera shot: bytes scale with pixels and quality; only 1200px @ 0.8 or lower fits 300k.
      const size = Math.round(this.width * this.height * q * 0.3);
      cb(new Blob([new Uint8Array(size)], { type: "image/jpeg" }));
    });
    const blob = await jpegFromFile(jpegFile(), { edge: 1600, maxBytes: 300_000 });
    expect(blob.size).toBeLessThanOrEqual(300_000);
    expect(tries[0]).toEqual({ w: 1600, q: 0.9 });
    const widths = [...new Set(tries.map((t) => t.w))];
    expect(widths).toEqual([1600, 1200]);
    const at1600 = tries.filter((t) => t.w === 1600).map((t) => t.q);
    expect(at1600).toEqual([0.9, 0.8, 0.7, 0.6]);
    expect(tries.at(-1)?.w).toBe(1200);
  });

  it("gives up as too large once the edge floor is reached", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    let smallest = Number.POSITIVE_INFINITY;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb) {
      smallest = Math.min(smallest, this.width);
      cb(new Blob([new Uint8Array(500_000)], { type: "image/jpeg" }));
    });
    await expect(jpegFromFile(jpegFile(), { edge: 1600, maxBytes: 1_000 })).rejects.toThrow(/too large/);
    expect(smallest).toBeGreaterThanOrEqual(320);
    expect(smallest).toBeLessThan(480);
  });
});

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { avatarDownloadName, copyImageElement, downloadImage, fetchImageBlob, pngFromImage, uploadAvatarFile } from "@/app/lib/avatar";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jpegFile(): File {
  const bytes = new Uint8Array(64);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return new File([bytes], "a.jpg", { type: "image/jpeg" });
}

describe("avatarDownloadName", () => {
  it("names the file after the slug and the picture type", () => {
    expect(avatarDownloadName("kit", "image/jpeg")).toBe("kit-avatar.jpg");
    expect(avatarDownloadName("Ada", "image/png; charset=binary")).toBe("ada-avatar.png");
    expect(avatarDownloadName("kit", "image/webp")).toBe("kit-avatar.webp");
    expect(avatarDownloadName("kit", "image/gif")).toBe("kit-avatar.gif");
    expect(avatarDownloadName("kit", "image/svg+xml")).toBe("kit-avatar.svg");
    expect(avatarDownloadName("", "")).toBe("agent-avatar.jpg");
  });
});

describe("fetchImageBlob", () => {
  it("keeps a typed blob and fills a missing type from the response", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/png" } }));
    expect((await fetchImageBlob("/face.png")).type).toBe("image/png");

    const raw = new Blob([new Uint8Array([2])]);
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      headers: { get: (name: string) => name === "Content-Type" ? "image/webp; charset=binary" : null },
      blob: async () => raw,
    }));
    const filled = await fetchImageBlob("/face.webp");
    expect(filled.type).toBe("image/webp");
    expect(new Uint8Array(await filled.arrayBuffer())).toEqual(new Uint8Array([2]));
  });
});

function faceImage(width = 8, height = 8): HTMLImageElement {
  const img = document.createElement("img");
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
  return img;
}

describe("pngFromImage", () => {
  it("says when the picture cannot be drawn", async () => {
    await expect(pngFromImage(faceImage(0, 0))).rejects.toThrow("could not copy that image");

    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(pngFromImage(faceImage())).rejects.toThrow("could not copy that image");

    getContext.mockReturnValue({
      drawImage() {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
      cb(null);
    });
    await expect(pngFromImage(faceImage())).rejects.toThrow("could not copy that image");
  });
});

describe("copyImageElement", () => {
  function stubClipboard() {
    const written: Blob[] = [];
    class Item {
      constructor(public data: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", Item);
    const write = vi.fn(async (list: Item[]) => {
      written.push(await list[0].data["image/png"]);
    });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    return { write, written };
  }

  it("writes a png of the picture on screen", async () => {
    const png = new Blob([new Uint8Array([9])], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
      cb(png);
    });
    const { write, written } = stubClipboard();
    await copyImageElement(faceImage());
    expect(write).toHaveBeenCalledOnce();
    expect(written[0]).toBe(png);
  });

  it("says when the clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(copyImageElement(faceImage())).rejects.toThrow("could not copy that image");
  });
});

describe("downloadImage", () => {
  it("saves the current picture under the slug", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (_input: RequestInfo, init?: RequestInit) => {
      expect(init?.credentials).toBe("include");
      return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } });
    });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(document, "createElement").mockImplementation((tag: string, _options?: ElementCreationOptions) => {
      const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (tag === "a") {
        vi.spyOn(el, "click").mockImplementation(() => {
          clicked.push(el as HTMLAnchorElement);
        });
      }
      return el;
    });
    try {
      await downloadImage("blob:face", "kit");
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe("kit-avatar.jpg");
      expect(clicked[0].href).toMatch(/^blob:/);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("uploadAvatarFile", () => {
  it("posts multipart avatar.jpg and returns the rev", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toContain("/api/chat/avatar?slug=kit");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      return Response.json({ ok: true, rev: 9, detail: "saved avatar.jpg" });
    });
    const got = await uploadAvatarFile({ slug: "kit", file: jpegFile() });
    expect(got).toEqual({ ok: true, rev: 9 });
  });

  it("surfaces a Worker error", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    vi.stubGlobal("fetch", async () => Response.json({ error: "need a JPEG" }, { status: 400 }));
    const got = await uploadAvatarFile({ slug: "kit", file: jpegFile() });
    expect(got).toEqual({ ok: false, error: "need a JPEG" });
  });

  it("maps convert and network failures", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("nope");
    });
    expect((await uploadAvatarFile({ slug: "kit", file: jpegFile() })).ok).toBe(false);

    vi.stubGlobal("createImageBitmap", async () => ({ width: 8, height: 8, close() {} }));
    const tiny = new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" });
    expect((await uploadAvatarFile({ slug: "kit", file: tiny })).ok).toBe(false);

    vi.stubGlobal("createImageBitmap", async () => ({ width: 64, height: 64, close() {} }));
    vi.stubGlobal("fetch", async () => {
      throw new Error("net");
    });
    expect((await uploadAvatarFile({ slug: "kit", file: jpegFile() })).ok).toBe(false);
  });
});

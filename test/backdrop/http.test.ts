import { describe, expect, it } from "vitest";
import { backdropRequestPath, readBackdropUpload } from "@/lib/backdrop/http";
import { BACKDROP_MAX_BYTES } from "@/lib/backdrop/store";

describe("backdropRequestPath", () => {
  it("mirrors the avatar path on /api/chat/backdrop", () => {
    expect(backdropRequestPath({ slug: "kit" })).toBe("/api/chat/backdrop?slug=kit");
    expect(backdropRequestPath({ slug: "kit", rev: 0 })).toBe("/api/chat/backdrop?slug=kit");
    expect(backdropRequestPath({ slug: "kit", rev: 9, secret: "s", bearer: "b" })).toBe(
      "/api/chat/backdrop?slug=kit&v=9&secret=s&bearer=b",
    );
  });
});

describe("readBackdropUpload", () => {
  it("reads raw jpeg bytes or a multipart file", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    const raw = await readBackdropUpload(new Request("https://x/api/chat/backdrop", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: jpeg,
    }));
    expect(raw.ok && raw.bytes.byteLength).toBe(4);

    const form = new FormData();
    form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "backdrop.jpg");
    const multi = await readBackdropUpload(new Request("https://x/api/chat/backdrop", { method: "POST", body: form }));
    expect(multi.ok && multi.bytes[0]).toBe(0xff);
  });

  it("caps at the backdrop budget, not the 5 MB face cap", async () => {
    const header = await readBackdropUpload(new Request("https://x/api/chat/backdrop", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(BACKDROP_MAX_BYTES + 1) },
      body: new Uint8Array([0xff, 0xd8, 0xff, 1]),
    }));
    expect(header).toEqual({ ok: false, detail: "image too large (max 1.5MB)" });

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(BACKDROP_MAX_BYTES + 1)], { type: "image/jpeg" }), "backdrop.jpg");
    const multi = await readBackdropUpload(new Request("https://x/api/chat/backdrop", { method: "POST", body: form }));
    expect(multi).toEqual({ ok: false, detail: "image too large (max 1.5MB)" });

    const raw = await readBackdropUpload(new Request("https://x/api/chat/backdrop", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(BACKDROP_MAX_BYTES + 1),
    }));
    expect(raw).toEqual({ ok: false, detail: "image too large (max 1.5MB)" });
  });
});

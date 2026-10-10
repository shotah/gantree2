import { describe, expect, it } from "vitest";
import { encodeBackdropNotice, packBackdrop } from "@/lib/chat/backdrop";
import { blobEtag, blobResponse, etagMatches } from "@/lib/chat/blob";
import { encodeFaceNotice, packAvatar } from "@/lib/chat/face";
import { acceptJpeg } from "@/lib/chat/jpeg";
import { displaySlug } from "@/lib/chat/slug";

function jpeg(n = 32): Uint8Array {
  const bytes = new Uint8Array(n);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

describe("face and backdrop", () => {
  it("packs a jpeg and refuses anything else", () => {
    const ok = packAvatar(jpeg(), 5);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.stored.rev).toBe(5);
      expect(new Uint8Array(ok.stored.jpeg)[0]).toBe(0xff);
    }
    expect(packAvatar(new Uint8Array(32), 1).ok).toBe(false);
    expect(packAvatar(jpeg(16), 1).ok).toBe(false);
    expect(acceptJpeg(jpeg(5 * 1024 * 1024 + 1)).ok).toBe(false);
    expect(encodeFaceNotice(5)).toBe(JSON.stringify({ kind: "face", text: "5" }));
  });

  it("packs a backdrop and refuses one past the row cap", () => {
    const ok = packBackdrop(jpeg(), 9);
    expect(ok.ok).toBe(true);
    expect(packBackdrop(jpeg(1_500_001), 9)).toEqual({ ok: false, detail: "image too large (max 1.5MB)" });
    expect(packBackdrop(new Uint8Array(40), 9).ok).toBe(false);
    expect(encodeBackdropNotice(0)).toBe(JSON.stringify({ kind: "backdrop", rev: 0 }));
    expect(encodeBackdropNotice(9)).toBe(JSON.stringify({ kind: "backdrop", rev: 9 }));
  });

  it("titles an empty slug Kit", () => {
    expect(displaySlug("kit")).toBe("Kit");
    expect(displaySlug("  ")).toBe("Kit");
    expect(displaySlug("ada")).toBe("Ada");
  });
});

describe("blob response", () => {
  it("returns the jpeg or a 304 when the rev matches", () => {
    const bytes = jpeg();
    const jpegBuf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(jpegBuf).set(bytes);
    const stored = { jpeg: jpegBuf, rev: 7 };
    const hit = blobResponse(stored, null);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("X-Chat-Rev")).toBe("7");
    expect(hit.headers.get("Content-Type")).toBe("image/jpeg");
    expect(hit.headers.get("ETag")).toBe(blobEtag(7));
    const fresh = blobResponse(stored, `"7"`);
    expect(fresh.status).toBe(304);
    expect(etagMatches(null, `"7"`)).toBe(false);
    expect(etagMatches(`W/"7", *`, `"7"`)).toBe(true);
    expect(etagMatches("nope", `"7"`)).toBe(false);
  });
});

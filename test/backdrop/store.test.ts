import { describe, expect, it } from "vitest";
import {
  BACKDROP_MAX_BYTES,
  BACKDROP_STORE_KEY,
  backdropRevFromUnknown,
  encodeBackdropNotice,
  packBackdrop,
} from "@/lib/backdrop/store";
import { AVATAR_STORE_KEY } from "@/lib/avatar/store";
import { parseFrame } from "@/lib/chat/frame";

function fakeJpeg(n = 64): Uint8Array {
  const b = new Uint8Array(n);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
}

describe("packBackdrop", () => {
  it("copies jpeg bytes and stamps a rev, on its own storage key", () => {
    const got = packBackdrop(fakeJpeg(), 1_700_000_000_000);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.stored.rev).toBe(1_700_000_000_000);
      expect(new Uint8Array(got.stored.jpeg)[0]).toBe(0xff);
    }
    expect(BACKDROP_STORE_KEY).not.toBe(AVATAR_STORE_KEY);
  });

  it("refuses non-jpeg, tiny, and anything over the 1.5 MB row budget", () => {
    expect(packBackdrop(new Uint8Array(8), 1).ok).toBe(false);
    const png = new Uint8Array(64);
    png[0] = 0x89;
    png[1] = 0x50;
    expect(packBackdrop(png, 1).ok).toBe(false);
    const big = fakeJpeg(BACKDROP_MAX_BYTES + 1);
    expect(packBackdrop(big, 1)).toEqual({ ok: false, detail: "image too large (max 1.5MB)" });
    expect(packBackdrop(fakeJpeg(BACKDROP_MAX_BYTES), 1).ok).toBe(true);
    // SQLite-backed Durable Object rows cap at 2 MB (key + value).
    expect(BACKDROP_MAX_BYTES).toBeLessThan(2_000_000);
  });
});

describe("backdrop notice", () => {
  it("carries rev as a number and no text, so a mouth that does not know it drops it", () => {
    const wire = encodeBackdropNotice(42);
    const raw = JSON.parse(wire) as Record<string, unknown>;
    expect(raw).toEqual({ kind: "backdrop", rev: 42 });
    expect("text" in raw).toBe(false);
    expect("images" in raw).toBe(false);
  });

  it("round-trips a rev, treats 0 as cleared, and ignores chat frames and junk", () => {
    expect(backdropRevFromUnknown(JSON.parse(encodeBackdropNotice(42)))).toBe(42);
    expect(backdropRevFromUnknown(JSON.parse(encodeBackdropNotice(0)))).toBe(0);
    expect(backdropRevFromUnknown({ kind: "backdrop", rev: 7.5 })).toBeNull();
    expect(backdropRevFromUnknown({ kind: "backdrop", rev: -1 })).toBeNull();
    expect(backdropRevFromUnknown({ kind: "backdrop", rev: "42" })).toBeNull();
    expect(backdropRevFromUnknown({ kind: "backdrop", text: "42" })).toBeNull();
    expect(backdropRevFromUnknown({ kind: "face", text: "42" })).toBeNull();
    expect(backdropRevFromUnknown({ kind: "reply", text: "hi", rev: 3 })).toBeNull();
    expect(backdropRevFromUnknown(null)).toBeNull();
    expect(backdropRevFromUnknown("backdrop")).toBeNull();
  });

  it("is not a mailbox frame kind: a phone that sends it is refused", () => {
    const got = parseFrame(encodeBackdropNotice(1), { role: "phone" });
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.error).toBe("bad frame");
    }
  });
});

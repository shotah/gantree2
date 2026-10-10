import { describe, expect, it } from "vitest";
import { acceptJpeg, AVATAR_MAX_BYTES, shouldPassthroughJpeg } from "@/lib/avatar/jpeg";

function fakeJpeg(n = 128): Uint8Array {
  const b = new Uint8Array(n);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[n - 1] = 0xd9;
  return b;
}

describe("acceptJpeg", () => {
  it("rejects tiny, huge, and non-jpeg", () => {
    expect(acceptJpeg(fakeJpeg(8)).ok).toBe(false);
    expect(acceptJpeg(new Uint8Array(AVATAR_MAX_BYTES + 1)).ok).toBe(false);
    const png = new Uint8Array(64);
    png[0] = 0x89;
    png[1] = 0x50;
    expect(acceptJpeg(png).ok).toBe(false);
    expect(acceptJpeg(fakeJpeg()).ok).toBe(true);
  });
});

describe("shouldPassthroughJpeg", () => {
  it("keeps a small jpeg and rescales a wide one", () => {
    expect(shouldPassthroughJpeg({ type: "image/jpeg", size: 100, width: 64, height: 64 })).toBe(true);
    expect(shouldPassthroughJpeg({ type: "image/png", size: 100, width: 64, height: 64 })).toBe(false);
    expect(shouldPassthroughJpeg({ type: "image/jpeg", size: 100, width: 2000, height: 64 })).toBe(false);
    expect(shouldPassthroughJpeg({
      type: "image/jpeg",
      size: 2_000_000,
      width: 64,
      height: 64,
      maxBytes: 1_500_000,
    })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { displaySlug, encodeFaceNotice, faceRevFromUnknown, packAvatar } from "@/lib/avatar/store";

function fakeJpeg(n = 64): Uint8Array {
  const b = new Uint8Array(n);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
}

describe("packAvatar", () => {
  it("copies jpeg bytes and stamps a rev", () => {
    const bytes = fakeJpeg();
    const got = packAvatar(bytes, 1_700_000_000_000);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.stored.rev).toBe(1_700_000_000_000);
      expect(new Uint8Array(got.stored.jpeg)[0]).toBe(0xff);
    }
    expect(packAvatar(new Uint8Array(8), 1).ok).toBe(false);
  });
});

describe("face notice", () => {
  it("round-trips a rev and ignores chat frames", () => {
    expect(faceRevFromUnknown(JSON.parse(encodeFaceNotice(42)))).toBe(42);
    expect(faceRevFromUnknown({ kind: "reply", text: "hi" })).toBeNull();
    expect(faceRevFromUnknown({ kind: "face", text: "nope" })).toBeNull();
    expect(faceRevFromUnknown(null)).toBeNull();
  });
});

describe("displaySlug", () => {
  it("title-cases the crane slug", () => {
    expect(displaySlug("kit")).toBe("Kit");
    expect(displaySlug("")).toBe("Kit");
    expect(displaySlug(" ada")).toBe("Ada");
  });
});

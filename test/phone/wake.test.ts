import { describe, expect, it, vi } from "vitest";
import { releaseScreenWake, requestScreenWake } from "@/lib/phone/wake";

describe("wake lock", () => {
  it("returns null when missing or denied", async () => {
    expect(await requestScreenWake(undefined)).toBeNull();
    expect(await requestScreenWake({
      request: async () => {
        throw new Error("denied");
      },
    })).toBeNull();
  });

  it("requests and releases a sentinel", async () => {
    const release = vi.fn(async () => undefined);
    const sentinel = await requestScreenWake({
      request: async (type) => {
        expect(type).toBe("screen");
        return { release };
      },
    });
    expect(sentinel).toEqual({ release });
    expect(await releaseScreenWake(sentinel)).toBeNull();
    expect(release).toHaveBeenCalledOnce();
    expect(await releaseScreenWake({ released: true, release })).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });
});

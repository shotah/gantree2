import { describe, expect, it, vi } from "vitest";
import { requestMicAccess } from "@/lib/phone/mic";

describe("requestMicAccess", () => {
  it("is unsupported without getUserMedia", async () => {
    expect(await requestMicAccess(undefined)).toBe("unsupported");
  });

  it("grants then stops the tracks so the LED does not stay on", async () => {
    const stop = vi.fn();
    const gum = vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] }));
    expect(await requestMicAccess(gum)).toBe("granted");
    expect(gum).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("maps NotAllowedError to denied and NotFoundError to unsupported", async () => {
    expect(await requestMicAccess(async () => {
      const err = new Error("nope");
      err.name = "NotAllowedError";
      throw err;
    })).toBe("denied");
    expect(await requestMicAccess(async () => {
      const err = new Error("none");
      err.name = "NotFoundError";
      throw err;
    })).toBe("unsupported");
  });
});

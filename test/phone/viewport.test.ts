import { describe, expect, it, vi } from "vitest";
import { recoverViewport, viewportShellHeight } from "@/lib/phone/viewport";

describe("viewport", () => {
  it("scrolls the window home when the API exists", () => {
    const scrollTo = vi.fn();
    recoverViewport({ scrollTo, visualViewport: { height: 640 } });
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    recoverViewport({ scrollTo });
    recoverViewport(null);
    recoverViewport({});
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it("formats a positive visual-viewport height", () => {
    expect(viewportShellHeight(640)).toBe("640px");
    expect(viewportShellHeight(0)).toBeUndefined();
    expect(viewportShellHeight(Number.NaN)).toBeUndefined();
    expect(viewportShellHeight(undefined)).toBeUndefined();
  });
});

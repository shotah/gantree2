import { describe, expect, it, vi } from "vitest";
import { bumpBadge, clearBadgeCount, shouldBadge } from "@/lib/phone/badge";

describe("badge", () => {
  it("only counts hidden push and reply", () => {
    expect(shouldBadge(false, "push")).toBe(false);
    expect(shouldBadge(true, "push")).toBe(true);
    expect(shouldBadge(true, "reply")).toBe(true);
    expect(shouldBadge(true, "cmds")).toBe(false);
    expect(shouldBadge(true, "draft")).toBe(false);
  });

  it("bumps and clears the OS badge", () => {
    const api = { setAppBadge: vi.fn(async () => undefined), clearAppBadge: vi.fn(async () => undefined) };
    expect(bumpBadge(2, api)).toBe(3);
    expect(api.setAppBadge).toHaveBeenCalledWith(3);
    expect(clearBadgeCount(api)).toBe(0);
    expect(api.clearAppBadge).toHaveBeenCalledOnce();
  });
});

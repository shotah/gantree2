import { describe, expect, it, vi } from "vitest";
import { browserNet } from "@/app/lib/net";

describe("browserNet", () => {
  it("is omitted without connection", () => {
    expect(browserNet()).toBeUndefined();
  });

  it("delegates when connection exists", () => {
    vi.stubGlobal("navigator", { connection: { type: "wifi" } });
    expect(browserNet()).toBe("wifi");
    vi.unstubAllGlobals();
  });
});

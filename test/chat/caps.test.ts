import { describe, expect, it } from "vitest";
import { headerSaysTooLarge } from "@/lib/chat/caps";

describe("headerSaysTooLarge", () => {
  it("is true only when a declared length is over the cap", () => {
    expect(headerSaysTooLarge("11", 10)).toBe(true);
    expect(headerSaysTooLarge("10", 10)).toBe(false);
    expect(headerSaysTooLarge(null, 10)).toBe(false);
    expect(headerSaysTooLarge("nope", 10)).toBe(false);
  });
});

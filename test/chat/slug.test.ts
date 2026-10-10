import { describe, expect, it } from "vitest";
import { parseSlug, slugFromPath } from "@/lib/chat/slug";

describe("slug", () => {
  it("accepts letter-first slugs up to 32", () => {
    expect(parseSlug("kit")).toBe("kit");
    expect(parseSlug("Ada-2")).toBe("ada-2");
    expect(parseSlug("a".repeat(32))).toBe("a".repeat(32));
  });

  it("rejects empty, digit-first, and long names", () => {
    expect(parseSlug("")).toBeNull();
    expect(parseSlug("1kit")).toBeNull();
    expect(parseSlug("a".repeat(33))).toBeNull();
    expect(parseSlug("has_underscore")).toBeNull();
  });

  it("reads /ws/:slug and nothing else", () => {
    expect(slugFromPath("/ws/kit")).toBe("kit");
    expect(slugFromPath("/ws/kit/extra")).toBeNull();
    expect(slugFromPath("/api/ws/kit")).toBeNull();
    expect(slugFromPath("/ws/1bad")).toBeNull();
  });
});

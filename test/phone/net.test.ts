import { describe, expect, it } from "vitest";
import { readNet } from "@/lib/phone/net";

describe("readNet", () => {
  it("omits when the API is missing or the radio is down", () => {
    expect(readNet(undefined)).toBeUndefined();
    expect(readNet(null)).toBeUndefined();
    expect(readNet({})).toBeUndefined();
    expect(readNet({ type: "none" })).toBeUndefined();
  });

  it("maps wifi, cellular, and leftover types", () => {
    expect(readNet({ type: "wifi" })).toBe("wifi");
    expect(readNet({ type: "ethernet" })).toBe("wifi");
    expect(readNet({ type: "cellular" })).toBe("cellular");
    expect(readNet({ effectiveType: "4g" })).toBe("cellular");
    expect(readNet({ type: "bluetooth" })).toBe("unknown");
    expect(readNet({ type: "other", effectiveType: "slow-2g" })).toBe("cellular");
  });
});

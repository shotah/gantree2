import { describe, expect, it } from "vitest";
import { readDevicePermission, blockedHint, micAskState } from "@/lib/phone/permit";

describe("device permission", () => {
  it("keeps the three PermissionStatus names and treats junk as unsupported", () => {
    expect(readDevicePermission("granted")).toBe("granted");
    expect(readDevicePermission("denied")).toBe("denied");
    expect(readDevicePermission("prompt")).toBe("prompt");
    expect(readDevicePermission("nope")).toBe("unsupported");
    expect(readDevicePermission(undefined)).toBe("unsupported");
  });

  it("names blocked vs missing, and is quiet when we can still ask", () => {
    expect(blockedHint("denied")).toBe("Blocked — enable in system settings.");
    expect(blockedHint("unsupported")).toBe("Not available in this browser.");
    expect(blockedHint("prompt")).toBe("");
    expect(blockedHint("granted")).toBe("");
  });

  it("does not treat a microphone query of denied as a stop until getUserMedia runs", () => {
    expect(micAskState("denied", null)).toBe("prompt");
    expect(micAskState("prompt", null)).toBe("prompt");
    expect(micAskState("denied", "granted")).toBe("granted");
    expect(micAskState("prompt", "denied")).toBe("denied");
    expect(micAskState("granted", null)).toBe("granted");
    expect(micAskState("prompt", "unsupported")).toBe("unsupported");
  });
});

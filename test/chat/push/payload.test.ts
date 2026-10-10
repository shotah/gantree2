import { describe, expect, it } from "vitest";
import { notifyBody, NOTIFY_TAG } from "@/lib/chat/push/payload";

describe("push payload", () => {
  it("clips a long body and names an empty one", () => {
    const long = "a".repeat(200);
    expect(notifyBody(long).endsWith("…")).toBe(true);
    expect(notifyBody(long).length).toBe(140);
    expect(notifyBody("  ")).toBe("New message");
    expect(notifyBody(undefined, true)).toBe("Photo");
    expect(NOTIFY_TAG).toBe("chat");
  });
});

import { describe, expect, it } from "vitest";
import { shouldWebPush, webPushUserIds, windowBlocksPushToast } from "@/lib/chat/push/target";

describe("push target", () => {
  it("only wakes lock-screen for crane push and reply", () => {
    expect(shouldWebPush("push")).toBe(true);
    expect(shouldWebPush("reply")).toBe(true);
    expect(shouldWebPush("inbound")).toBe(false);
    expect(shouldWebPush("error")).toBe(false);
    expect(shouldWebPush("cmds")).toBe(false);
  });

  it("targets the frame user or every stored phone", () => {
    expect(webPushUserIds({ frameUserId: "ada", storedUserIds: ["ada"] })).toEqual(["ada"]);
    expect(webPushUserIds({
      storedUserIds: ["ada", "bob", "bob", ""],
    })).toEqual(["ada", "bob"]);
  });

  it("skips the tray when a window is focused", () => {
    expect(windowBlocksPushToast([{ focused: true }])).toBe(true);
    expect(windowBlocksPushToast([{ focused: false }])).toBe(false);
    expect(windowBlocksPushToast([{}])).toBe(false);
    expect(windowBlocksPushToast([])).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { buzzPush } from "@/lib/phone/haptic";

describe("buzzPush", () => {
  it("vibrates only for a visible push", () => {
    const vibrate = vi.fn(() => true);
    buzzPush({ kind: "push", hidden: false, vibrate });
    expect(vibrate).toHaveBeenCalledWith(40);
    vibrate.mockClear();
    buzzPush({ kind: "push", hidden: true, vibrate });
    buzzPush({ kind: "reply", hidden: false, vibrate });
    buzzPush({ kind: "push", hidden: false });
    expect(vibrate).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { isPinnedToBottom, pinToBottom, THREAD_PIN_PX } from "@/lib/phone/threadScroll";

describe("thread scroll pin", () => {
  it("treats the last sliver as pinned and writes scrollTop to the bottom", () => {
    const el = { scrollHeight: 1000, scrollTop: 1000 - 200 - THREAD_PIN_PX, clientHeight: 200 };
    expect(isPinnedToBottom(el)).toBe(true);
    expect(isPinnedToBottom({ ...el, scrollTop: 0 })).toBe(false);
    pinToBottom(el);
    expect(el.scrollTop).toBe(1000);
  });
});

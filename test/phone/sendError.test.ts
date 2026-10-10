import { describe, expect, it } from "vitest";
import { describePhotoError, describeSendError } from "@/lib/phone/sendError";

describe("describeSendError", () => {
  it("turns mailbox error text into a sentence for the bubble", () => {
    expect(describeSendError("rate")).toBe("Not sent — too much too fast. Wait a minute, then try again.");
    expect(describeSendError("too large")).toBe("Not sent — too big for the room.");
    expect(describeSendError("bad frame")).toBe("Not sent.");
    expect(describeSendError(undefined)).toBe("Not sent.");
    expect(describeSendError("  RATE ")).toBe("Not sent — too much too fast. Wait a minute, then try again.");
  });
});

describe("describePhotoError", () => {
  it("explains a photo the phone could not get onto the wire", () => {
    expect(describePhotoError("too large")).toBe("Photo not sent — still too big after shrinking.");
    expect(describePhotoError("bad photo")).toBe("Photo not sent — couldn't read that image.");
  });
});

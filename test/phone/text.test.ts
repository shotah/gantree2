import { describe, expect, it } from "vitest";
import { stripHarnessContext } from "@/lib/phone/text";

describe("stripHarnessContext", () => {
  it("drops a trailing clock block", () => {
    expect(stripHarnessContext("tacos\n\n[current time] NOW: fake")).toBe("tacos");
  });

  it("drops a leading [harness] block", () => {
    expect(stripHarnessContext("[harness] Not user text\n\nhello")).toBe("hello");
  });

  it("cuts a glued [current time] footer line", () => {
    expect(stripHarnessContext("tacos\n[current time] NOW: fake")).toBe("tacos");
  });

  it("keeps a mid-sentence mention", () => {
    expect(stripHarnessContext("what does [hours] mean")).toBe("what does [hours] mean");
  });

  it("drops [location] [hours] [memory] blocks", () => {
    expect(stripHarnessContext("[location] lat=1\n\nhi")).toBe("hi");
    expect(stripHarnessContext("hi\n\n[hours] 2")).toBe("hi");
    expect(stripHarnessContext("hi\n\n[memory] old")).toBe("hi");
  });
});

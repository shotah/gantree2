import { describe, expect, it } from "vitest";
import { phonesToClose, roomAllows } from "@/lib/chat/room";

const ada = "118212345678901234567";

describe("roomAllows", () => {
  it("matches a room sub", () => {
    expect(roomAllows([{ sub: ada }], { sub: ada })).toBe(true);
    expect(roomAllows([{ sub: ada }], { sub: "9999999999" })).toBe(false);
    expect(roomAllows([{ sub: ada }], { sub: "" })).toBe(false);
  });

  it("matches a verified email, lowercased", () => {
    expect(roomAllows(
      [{ email: "ada@example.com" }],
      { sub: ada, email: "Ada@Example.com", emailVerified: true },
    )).toBe(true);
  });

  it("refuses an unverified email", () => {
    expect(roomAllows(
      [{ email: "ada@example.com" }],
      { sub: ada, email: "ada@example.com", emailVerified: false },
    )).toBe(false);
    expect(roomAllows(
      [{ email: "ada@example.com" }],
      { sub: ada, email: "ada@example.com" },
    )).toBe(false);
  });

  it("still admits a static ALLOWED_SUBS extra", () => {
    expect(roomAllows([], { sub: ada }, ada)).toBe(true);
    expect(roomAllows(undefined, { sub: ada }, `${ada}:ada@example.com`)).toBe(true);
    expect(roomAllows([], { sub: ada }, `  ${ada}  ${ada}:again`)).toBe(true);
  });

  it("fails closed on an empty list", () => {
    expect(roomAllows([], { sub: ada, email: "ada@example.com", emailVerified: true })).toBe(false);
    expect(roomAllows(undefined, { sub: ada })).toBe(false);
  });

  it("lists phones to close after a new allow", () => {
    const phones = [
      { sub: ada, email: "ada@example.com", emailVerified: true },
      { sub: "9999999999", email: "bob@example.com", emailVerified: true },
    ];
    expect(phonesToClose(phones, [{ email: "ada@example.com" }])).toEqual([phones[1]]);
  });
});

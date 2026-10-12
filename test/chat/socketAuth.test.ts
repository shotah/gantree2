import { describe, expect, it } from "vitest";
import { parseEmailVerified, parseExpMs, socketMessageAllowed } from "@/lib/chat/socketAuth";

const ada = "118212345678901234567";
const extra = `${ada}:ada@example.test`;

function phone(input: Omit<Parameters<typeof socketMessageAllowed>[0], "role" | "enforce" | "doorRole" | "slug"> & {
  doorRole?: "admin" | "operator" | "member";
  slug?: string;
}) {
  return socketMessageAllowed({
    role: "phone",
    enforce: true,
    doorRole: input.doorRole ?? "member",
    slug: input.slug ?? "kit",
    assignedAgents: input.assignedAgents ?? [],
    ...input,
  });
}

describe("socketAuth", () => {
  it("closes on a yanked sub when Google is on", () => {
    expect(phone({
      userId: "9999999999",
      allowedSubs: extra,
      now: 1_000,
    })).toBe(false);
  });

  it("closes when exp has passed", () => {
    expect(phone({
      userId: ada,
      allowedSubs: extra,
      expMs: 1_000,
      now: 1_001,
    })).toBe(false);
  });

  it("closes when the phone sub is missing", () => {
    expect(phone({
      allowedSubs: extra,
      now: 1_000,
    })).toBe(false);
  });

  it("skips the check in spike mode and for crane sockets", () => {
    expect(socketMessageAllowed({
      role: "phone",
      userId: "anyone",
      allowedSubs: "",
      now: 1_000,
    })).toBe(true);
    expect(socketMessageAllowed({
      role: "crane",
      userId: "not-a-human",
      allowedSubs: extra,
      enforce: true,
      now: 1_000,
    })).toBe(true);
  });

  it("allows a listed sub before expiry", () => {
    expect(phone({
      userId: ada,
      allowedSubs: extra,
      expMs: 2_000,
      now: 1_000,
    })).toBe(true);
    expect(phone({
      userId: ada,
      allowedSubs: extra,
      now: 1_000,
    })).toBe(true);
  });

  it("admits an admin on an empty room and still rejects strangers", () => {
    expect(phone({
      userId: ada,
      email: "ada@example.com",
      emailVerified: true,
      roomUsers: [],
      doorRole: "admin",
      now: 1_000,
    })).toBe(true);
    expect(phone({
      userId: ada,
      email: "ada@example.com",
      emailVerified: true,
      roomUsers: [],
      now: 1_000,
    })).toBe(false);
  });

  it("admits a verified email on the room list and closes a removed socket", () => {
    const room = [{ email: "ada@example.com" }];
    expect(phone({
      userId: ada,
      email: "ada@example.com",
      emailVerified: true,
      roomUsers: room,
      now: 1_000,
    })).toBe(true);
    expect(phone({
      userId: ada,
      email: "ada@example.com",
      emailVerified: true,
      roomUsers: [],
      now: 1_000,
    })).toBe(false);
  });

  it("parses decimal millisecond exp tags and the verified flag", () => {
    expect(parseExpMs("1710000000000")).toBe(1_710_000_000_000);
    expect(parseExpMs(undefined)).toBeUndefined();
    expect(parseExpMs("")).toBeUndefined();
    expect(parseExpMs("nope")).toBeUndefined();
    expect(parseExpMs("0")).toBeUndefined();
    expect(parseEmailVerified("1")).toBe(true);
    expect(parseEmailVerified("0")).toBe(false);
    expect(parseEmailVerified(undefined)).toBe(false);
  });
});

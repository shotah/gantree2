import { describe, expect, it } from "vitest";
import { entryMatches, formatAllowlist, onList, parseAllowlist, parseEntry } from "@/lib/door/allowlist";

describe("parseEntry", () => {
  it("reads the three forms and lowercases email", () => {
    expect(parseEntry("118212345678901234567")).toEqual({ sub: "118212345678901234567", email: null });
    expect(parseEntry("118212345678901234567:Ada@Example.com")).toEqual({ sub: "118212345678901234567", email: "ada@example.com" });
    expect(parseEntry("Ada@Example.com")).toEqual({ sub: null, email: "ada@example.com" });
  });

  it("refuses junk", () => {
    expect(parseEntry("")).toBeNull();
    expect(parseEntry("ada")).toBeNull();
    expect(parseEntry("123")).toBeNull();
    expect(parseEntry("notdigits:ada@example.com")).toBeNull();
    expect(parseEntry("118212345678901234567:nope")).toBeNull();
  });
});

describe("parseAllowlist", () => {
  it("splits on commas and whitespace, drops junk, dedupes by sub then email", () => {
    const list = parseAllowlist("118212345678901234567:ada@example.com, ada@example.com\n118212345678901234567 bob@example.com junk");
    expect(formatAllowlist(list)).toBe("118212345678901234567:ada@example.com,bob@example.com");
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist(["a@b.co", "a@b.co"])).toHaveLength(1);
  });
});

describe("entryMatches", () => {
  const sub = "118212345678901234567";
  it("sub matches exactly; email only when verified", () => {
    expect(entryMatches({ sub, email: null }, { sub, email: null, emailVerified: false })).toBe(true);
    expect(entryMatches({ sub: null, email: "ada@example.com" }, { sub: "1", email: "ADA@example.com", emailVerified: true })).toBe(true);
    expect(entryMatches({ sub: null, email: "ada@example.com" }, { sub: "1", email: "ada@example.com", emailVerified: false })).toBe(false);
    expect(entryMatches({ sub: null, email: "ada@example.com" }, { sub: "1", email: "a.da@example.com", emailVerified: true })).toBe(false);
  });

  it("onList is any match", () => {
    const list = parseAllowlist("bob@example.com,999999999999");
    expect(onList(list, { sub: "999999999999", email: null, emailVerified: false })).toBe(true);
    expect(onList(list, { sub: "1", email: "eve@example.com", emailVerified: true })).toBe(false);
  });
});

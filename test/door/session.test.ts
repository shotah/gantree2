import { describe, expect, it } from "vitest";
import {
  clearCookieHeader,
  cookieHeader,
  OAUTH_TTL_S,
  openOAuth,
  openSession,
  readCookie,
  sealOAuth,
  sealSession,
  SESSION_TTL_S,
  sessionKey,
} from "@/lib/door/session";

const SECRET = "0123456789abcdef0123456789abcdef-more";

describe("sessionKey", () => {
  it("refuses a short secret and is deterministic", async () => {
    await expect(sessionKey("short")).rejects.toThrow(/32/);
    const a = await sessionKey(SECRET);
    const b = await sessionKey(SECRET);
    expect(a).toEqual(b);
    expect(a).toHaveLength(32);
  });
});

describe("session cookie", () => {
  it("round-trips, expires hard at 7 days, and refuses another key", async () => {
    const key = await sessionKey(SECRET);
    const now = Date.UTC(2026, 9, 10);
    const token = await sealSession(key, { sub: "118212345678901234567", email: "ada@example.com" }, now);
    expect(await openSession(key, token, now + 1000)).toEqual({ sub: "118212345678901234567", email: "ada@example.com" });
    expect(await openSession(key, token, now + SESSION_TTL_S * 1000 + 60_000)).toBeNull();
    const other = await sessionKey("another-secret-that-is-long-enough-xx");
    expect(await openSession(other, token, now)).toBeNull();
    expect(await openSession(key, "garbage", now)).toBeNull();
  });

  it("session and oauth cookies are not interchangeable", async () => {
    const key = await sessionKey(SECRET);
    const now = Date.now();
    const oauth = await sealOAuth(key, { state: "s", nonce: "n", verifier: "v", next: "/agents/kit" }, now);
    expect(await openSession(key, oauth, now)).toBeNull();
    expect(await openOAuth(key, oauth, now)).toEqual({ state: "s", nonce: "n", verifier: "v", next: "/agents/kit" });
    expect(await openOAuth(key, oauth, now + OAUTH_TTL_S * 1000 + 1000)).toBeNull();
  });
});

describe("cookie headers", () => {
  it("reads a named cookie", () => {
    const req = new Request("https://x.test/", { headers: { cookie: "a=1; gantree_session=abc%20d; b=2" } });
    expect(readCookie(req, "gantree_session")).toBe("abc d");
    expect(readCookie(req, "nope")).toBeNull();
  });

  it("Secure everywhere except http loopback", () => {
    const prod = cookieHeader("x", "v", new URL("https://gantree.example/"), 60);
    expect(prod).toContain("Secure");
    expect(prod).toContain("HttpOnly");
    expect(prod).toContain("SameSite=Lax");
    expect(cookieHeader("x", "v", new URL("http://127.0.0.1:3000/"), 60)).not.toContain("Secure");
    expect(cookieHeader("x", "v", new URL("http://192.168.1.5:3000/"), 60)).toContain("Secure");
    expect(clearCookieHeader("x", new URL("https://gantree.example/"))).toContain("Max-Age=0");
  });
});

import { describe, expect, it } from "vitest";
import { devDoor, loginError, loginHref } from "@/app/lib/login";

describe("login helpers", () => {
  it("maps error codes to copy and falls back", () => {
    expect(loginError(null)).toBeNull();
    expect(loginError("not_allowed")).toMatch(/not on the list/);
    expect(loginError("not_configured")).toMatch(/GOOGLE_CLIENT_ID/);
    expect(loginError("wat")).toMatch(/failed/);
  });

  it("carries a safe next into the start route", () => {
    expect(loginHref(null)).toBe("/api/auth/google");
    expect(loginHref("/agents/kit?x=1")).toBe("/api/auth/google?next=%2Fagents%2Fkit%3Fx%3D1");
    expect(loginHref("//evil.test")).toBe("/api/auth/google");
    expect(loginHref("https://evil.test")).toBe("/api/auth/google");
  });

  it("opens the dev door on loopback with GANTREE_DEV_USER, and nowhere else", () => {
    const env = { GANTREE_DEV_USER: "100000000000000000001:dev@example.com" };
    expect(devDoor(env, "127.0.0.1:3000", "/agents")).toEqual({ label: "dev@example.com", href: "/agents" });
    expect(devDoor(env, "localhost:3000", null)).toEqual({ label: "dev@example.com", href: "/" });
    expect(devDoor(env, "[::1]:3000", "//evil.test")).toEqual({ label: "dev@example.com", href: "/" });
    expect(devDoor({ GANTREE_DEV_USER: "100000000000000000001" }, "127.0.0.1:3000", null)?.label).toBe("100000000000000000001");
    expect(devDoor(env, "gantree.example.com", "/agents")).toBeNull();
    expect(devDoor(env, "203.0.113.5:3000", "/agents")).toBeNull();
    expect(devDoor({}, "127.0.0.1:3000", "/agents")).toBeNull();
    expect(devDoor({ GANTREE_DEV_USER: "not-a-sub:dev@example.com" }, "127.0.0.1:3000", null)).toBeNull();
    expect(devDoor(env, null, "/agents")).toBeNull();
    expect(devDoor(env, "bad host", "/agents")).toBeNull();
  });
});

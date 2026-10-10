import { describe, expect, it } from "vitest";
import { loginError, loginHref } from "@/app/lib/login";

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
});

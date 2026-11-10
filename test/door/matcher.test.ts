import { describe, expect, it, vi } from "vitest";
import { isPublicPath } from "@/lib/door/gate";
import { config } from "@/middleware";

vi.mock("next/server", () => ({ NextResponse: {} }));
vi.mock("@/lib/door/runtime", () => ({ doorEnv: () => ({}), userStore: () => ({}) }));

const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("middleware matcher", () => {
  it("skips the static prefixes only with their slash, like the gate", () => {
    for (const path of ["/assets/app.js", "/_next/static/x.js", "/_vinext/x"]) {
      expect(matcher.test(path)).toBe(false);
      expect(isPublicPath(path)).toBe(true);
    }
    for (const path of ["/assetsfoo", "/_nextfoo", "/_vinextfoo", "/assets"]) {
      expect(matcher.test(path)).toBe(true);
    }
  });

  it("still skips the exact static files", () => {
    for (const path of ["/favicon.ico", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/robots.txt", "/sw.js", "/manifest.webmanifest"]) {
      expect(matcher.test(path)).toBe(false);
    }
  });

  it("runs on pages and APIs", () => {
    for (const path of ["/", "/login", "/chat/ada", "/api/health", "/settings"]) {
      expect(matcher.test(path)).toBe(true);
    }
  });
});

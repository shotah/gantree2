import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION, RELEASE } from "@/app/lib/release";

describe("release", () => {
  it("matches package.json as a v-prefixed tag", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(RELEASE).toBe(`v${pkg.version}`);
  });
});

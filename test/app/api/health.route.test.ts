import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { PACKAGE_VERSION } from "@/app/lib/release";

describe("GET /api/health", () => {
  it("returns ok, the package version, and a time, with no-store", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json<{ ok: boolean; version: string; time: string }>();
    expect(body.ok).toBe(true);
    expect(body.version).toBe(PACKAGE_VERSION);
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

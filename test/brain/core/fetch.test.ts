import { describe, expect, it } from "vitest";
import { bindWorkerFetch } from "@/brain/core/fetch";

describe("bindWorkerFetch", () => {
  it("keeps this on the global when called as a method", async () => {
    const seen: unknown[] = [];
    const original = globalThis.fetch;
    function fake(this: unknown, input: RequestInfo | URL): Promise<Response> {
      seen.push(this);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(url));
    }
    globalThis.fetch = fake;
    try {
      const ctx = { fetch: bindWorkerFetch() };
      const res = await ctx.fetch("https://example.test/token");
      expect(await res.text()).toBe("https://example.test/token");
      expect(seen).toEqual([globalThis]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

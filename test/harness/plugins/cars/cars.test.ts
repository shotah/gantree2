import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink, nodeSql, type NodeDatabase } from "@/harness/core";
import type { CallContext, PluginContext, ToolResult } from "@/harness/core/tools";
import { cars } from "@/harness/plugins/cars";
import { clientFromEnv } from "@/harness/plugins/cars/client";
import { ACCOUNT_GET_DESCRIPTION, TOOL_NAMES } from "@/harness/plugins/cars/schema";

const call: CallContext = { userId: "u", sessionId: "s" };
const now = Date.UTC(2026, 9, 11);
const testVin = "1HGCM82633A004352";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function routeFetch(handler: (url: URL, init?: RequestInit) => Response): typeof fetch {
  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(new URL(href), init));
  };
}

function pluginCtx(env: Record<string, string>, fetchFn: typeof fetch = routeFetch(() => jsonResponse({}))): PluginContext {
  return {
    env,
    sql: nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase),
    clock: fixedClock(now, "UTC"),
    log: makeLogger(memorySink(), () => now),
    fetch: fetchFn,
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      list: async () => [],
    },
  };
}

function textOf(result: ToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

function toolNamed(ctx: PluginContext, name: string) {
  const tool = cars.tools(ctx).find((item) => item.name === name);
  if (tool === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
}

function snakeTool(name: string): boolean {
  const parts = name.split("_");
  const head = parts[0] ?? "";
  return parts.length >= 2 && /^[a-z]+$/.test(head) && parts.slice(1).every((part) => /^[a-z0-9]+$/.test(part));
}

describe("cars plugin", () => {
  it("publishes the Go tool list", () => {
    const ctx = pluginCtx({ MARKETCHECK_API_KEY: "k" });
    expect(cars.name).toBe("cars");
    const tools = cars.tools(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const name of tools.map((tool) => tool.name)) {
      expect(name.startsWith("cars_")).toBe(false);
      expect(snakeTool(name)).toBe(true);
    }
    const account = tools.find((tool) => tool.name === "account_get");
    expect(account?.description).toBe(ACCOUNT_GET_DESCRIPTION);
    expect(account?.single).toContain("MarketCheck");
  });

  it("is no_key without MARKETCHECK_API_KEY", async () => {
    expect(await cars.ready(pluginCtx({}))).toBe("no_key");
    expect(await cars.ready(pluginCtx({ MARKETCHECK_API_KEY: "  " }))).toBe("no_key");
    expect(await cars.ready(pluginCtx({ MARKETCHECK_API_KEY: "k" }))).toBeNull();
  });

  it("hits MarketCheck search and NeoVIN paths with api_key", async () => {
    const seen: string[] = [];
    const fetchFn = routeFetch((url) => {
      seen.push(url.pathname + url.search);
      expect(url.searchParams.get("api_key")).toBe("mc-test");
      if (url.pathname.endsWith("/search/car/active")) {
        return jsonResponse({
          num_found: 1,
          listings: [{
            id: "lst-1",
            heading: "2020 Toyota Camry LE",
            price: 21999,
            miles: 42000,
            vdp_url: "https://dealer.example/vdp/lst-1",
            dom: 12,
            build: { year: 2020, make: "Toyota", model: "Camry", trim: "LE" },
          }],
        });
      }
      if (url.pathname.endsWith(`/decode/car/neovin/${encodeURIComponent(testVin)}/specs`)) {
        return jsonResponse({ year: 2003, make: "Honda", model: "Accord", trim: "EX" });
      }
      return jsonResponse({}, 404);
    });
    const ctx = pluginCtx({ MARKETCHECK_API_KEY: "mc-test", MARKETCHECK_BASE_URL: "https://api.marketcheck.com/v2" }, fetchFn);

    const search = JSON.parse(textOf(await toolNamed(ctx, "listings_search").call({
      zip: "98101",
      make: "Toyota",
      rows: 5,
    }, call))) as { listings: { listing_url: string; make: string }[] }[];
    expect(search[0]?.listings[0]?.listing_url).toBe("https://dealer.example/vdp/lst-1");
    expect(search[0]?.listings[0]?.make).toBe("Toyota");
    expect(seen.some((line) => line.includes("/search/car/active?"))).toBe(true);

    const vin = JSON.parse(textOf(await toolNamed(ctx, "vin_get").call({ vin: testVin }, call))) as { make: string }[];
    expect(vin[0]?.make).toBe("Honda");
    expect(seen.some((line) => line.includes("/decode/car/neovin/"))).toBe(true);

    expect(clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn).baseURL).toBe("https://api.marketcheck.com/v2");
  });

  it("serves link_format without fetch and account_get as a single object", async () => {
    let hits = 0;
    const fetchFn = routeFetch(() => {
      hits += 1;
      return jsonResponse({});
    });
    const ctx = pluginCtx({ MARKETCHECK_API_KEY: "k" }, fetchFn);

    const link = textOf(await toolNamed(ctx, "link_format").call({ zip: "98101", make: "Toyota" }, call));
    expect(link.startsWith("[{\"location\":")).toBe(true);
    expect(link).toContain("cars.com/shopping/results");
    expect(hits).toBe(0);

    const bare = textOf(await toolNamed(ctx, "account_get").call({}, call));
    expect(bare.startsWith("{\"boot_note\":")).toBe(true);
    expect(bare).toContain("\"provider\":\"MarketCheck\"");
    expect(bare.startsWith("[")).toBe(false);
    expect(hits).toBe(0);

    const live = pluginCtx({ MARKETCHECK_API_KEY: "k", MARKETCHECK_BASE_URL: "https://api.marketcheck.com/v2" }, routeFetch((url) => {
      hits += 1;
      if (url.pathname.endsWith("/search/car/active")) {
        return jsonResponse({ num_found: 0, listings: [] });
      }
      return jsonResponse({});
    }));
    await toolNamed(live, "listings_search").call({ zip: "98101" }, call);
    const account = JSON.parse(textOf(await toolNamed(live, "account_get").call({}, call))) as {
      usage: { requests_per_month: number; source: string; requests_used: number };
    };
    expect(account.usage.requests_per_month).toBe(500);
    expect(account.usage.source).toBe("local_counter");
    expect(account.usage.requests_used).toBe(1);
    expect(hits).toBe(1);
  });

  it("returns row errors for listing 404 without isError", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.includes("/listing/car/")) {
        const id = decodeURIComponent(url.pathname.split("/listing/car/").pop()?.split("/").pop() ?? "");
        if (id === "missing") {
          return jsonResponse({ message: "nope" }, 404);
        }
        return jsonResponse({ id, vdp_url: "https://example/vdp" });
      }
      return jsonResponse({ num_found: 0, listings: [] });
    });
    const ctx = pluginCtx({ MARKETCHECK_API_KEY: "k", MARKETCHECK_BASE_URL: "https://api.marketcheck.com/v2" }, fetchFn);
    const result = await toolNamed(ctx, "listings_get").call({ ids: ["ok-id", "missing"] }, call);
    expect(result.isError).toBeUndefined();
    const rows = JSON.parse(textOf(result)) as { id?: string; error?: string }[];
    expect(rows[0]?.id).toBe("ok-id");
    expect(rows[1]?.error).toContain("404");
  });
});

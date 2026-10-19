import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink, nodeSql, type NodeDatabase } from "@/harness/core";
import type { CallContext, PluginContext, ToolResult } from "@/harness/core/tools";
import { parseZipList, resolveAreas } from "@/harness/plugins/rentals/areas";
import {
  clientFromEnv,
  createClient,
  defaultLimit,
  formatPriceRange,
  googleListingSearchURL,
  intentBuy,
  intentRent,
  maxAgentLimit,
  normalizeIntent,
  normalizePage,
  normalizePropertyType,
  summarizeListings,
  validateSearchRequest,
} from "@/harness/plugins/rentals/client";
import { expandListingsSearch, filterListingsByZips } from "@/harness/plugins/rentals/expand";
import { rentals } from "@/harness/plugins/rentals";
import { ACCOUNT_GET_DESCRIPTION, TOOL_NAMES } from "@/harness/plugins/rentals/schema";
import { QuotaError, usageTracker } from "@/harness/plugins/rentals/usage";

const call: CallContext = { userId: "u", sessionId: "s" };
const now = Date.UTC(2026, 9, 11);

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

function routeFetch(handler: (url: URL, init?: RequestInit) => Response): typeof fetch {
  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(new URL(href), init));
  };
}

function headerValue(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1] ?? "";
  }
  if (headers !== undefined) {
    const record = headers;
    return record[name] ?? record[name.toLowerCase()] ?? "";
  }
  return "";
}

function pluginCtx(env: Record<string, string>, fetchFn: typeof fetch = routeFetch(() => jsonResponse([]))): PluginContext {
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
  const tool = rentals.tools(ctx).find((item) => item.name === name);
  if (tool === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
}

const rentalListings = [
  {
    id: "123-Pine-St,-Seattle,-WA-98101",
    formattedAddress: "123 Pine St, Seattle, WA 98101",
    city: "Seattle",
    state: "WA",
    zipCode: "98101",
    propertyType: "Apartment",
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 650,
    price: 2100,
    status: "Active",
    daysOnMarket: 4,
    listedDate: "2026-07-28T00:00:00.000Z",
    latitude: 47.61,
    longitude: -122.33,
    listingAgent: { name: "Alex Agent", phone: "2065550100", email: "alex@example.com" },
  },
  {
    id: "456-Oak-Ave,-Seattle,-WA-98102",
    formattedAddress: "456 Oak Ave, Seattle, WA 98102",
    city: "Seattle",
    state: "WA",
    zipCode: "98102",
    propertyType: "Apartment",
    bedrooms: 0,
    bathrooms: 1,
    price: 1800,
    status: "Active",
    daysOnMarket: 12,
    listingOffice: { name: "Harbor Realty", website: "https://harbor.example.com/listing/456" },
  },
];

function snakeTool(name: string): boolean {
  const parts = name.split("_");
  const head = parts[0] ?? "";
  return parts.length >= 2 && /^[a-z]+$/.test(head) && parts.slice(1).every((part) => /^[a-z0-9]+$/.test(part));
}

describe("rentals plugin", () => {
  it("publishes the Go tool list", () => {
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k" });
    expect(rentals.name).toBe("rentals");
    const tools = rentals.tools(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const name of tools.map((tool) => tool.name)) {
      expect(name.startsWith("rentals_")).toBe(false);
      expect(snakeTool(name)).toBe(true);
    }
    const search = tools[0];
    expect(search?.description.startsWith("Search US long-term FOR-RENT")).toBe(true);
    expect(search?.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(search?.inputSchema.required).toBeUndefined();
    const properties = search?.inputSchema.properties as Record<string, { type: string; description: string }>;
    expect(properties.latitude).toEqual({ type: "number", description: "Search center latitude" });
    expect(properties.price_max.type).toBe("integer");
    expect(tools.find((tool) => tool.name === "listings_get")?.inputSchema.required).toEqual(["listing_id"]);
    expect(tools.find((tool) => tool.name === "rent_estimate_get")?.inputSchema.required).toEqual(["address"]);
    expect(tools.find((tool) => tool.name === "markets_get")?.inputSchema.required).toEqual(["zip_code"]);
    const account = tools.find((tool) => tool.name === "account_get");
    expect(account?.description).toBe(ACCOUNT_GET_DESCRIPTION);
    expect(account?.inputSchema).toEqual({ type: "object", additionalProperties: false });
  });

  it("is no_key without RENTCAST_API_KEY", async () => {
    expect(await rentals.ready(pluginCtx({}))).toBe("no_key");
    expect(await rentals.ready(pluginCtx({ RENTCAST_API_KEY: "  " }))).toBe("no_key");
    expect(await rentals.ready(pluginCtx({ RENTCAST_API_KEY: "k" }))).toBeNull();
  });

  it("builds a client from env and trims the base URL", () => {
    const ctx = pluginCtx({ RENTCAST_API_KEY: "test-key", RENTCAST_BASE_URL: "https://example.test/v1/" });
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, ctx.fetch);
    expect(client.apiKey).toBe("test-key");
    expect(client.baseURL).toBe("https://example.test/v1");
    expect(() => clientFromEnv({ ...ctx.env, RENTCAST_API_KEY: "" }, ctx.sql, ctx.clock, ctx.fetch)).toThrow(/RENTCAST_API_KEY is required/);
  });

  it("normalizes intent and property type", () => {
    expect(normalizeIntent("")).toBe(intentRent);
    expect(normalizeIntent("Rental")).toBe(intentRent);
    expect(normalizeIntent("for-rent")).toBe(intentRent);
    expect(normalizeIntent("lease")).toBe(intentRent);
    expect(normalizeIntent("purchase")).toBe(intentBuy);
    expect(normalizeIntent("for_sale")).toBe(intentBuy);
    expect(normalizeIntent("Sale")).toBe(intentBuy);
    expect(() => normalizeIntent("maybe")).toThrow(/intent must be rent or buy \(got "maybe"\)/);
    expect(normalizePropertyType("")).toBe("");
    expect(normalizePropertyType("Apartments")).toBe("Apartment");
    expect(normalizePropertyType("house")).toBe("Single Family");
    expect(normalizePropertyType("single_family")).toBe("Single Family");
    expect(normalizePropertyType("townhome")).toBe("Townhouse");
    expect(normalizePropertyType("duplex")).toBe("Multi-Family");
    expect(normalizePropertyType("Single Family")).toBe("Single Family");
    expect(normalizePropertyType("apartment|condo")).toBe("Apartment|Condo");
    expect(normalizePropertyType("house, condo")).toBe("Single Family|Condo");
    expect(normalizePropertyType("lot")).toBe("Land");
  });

  it("formats price ranges and pages", () => {
    expect(formatPriceRange(0, 0)).toBe("");
    expect(formatPriceRange(1200, 0)).toBe("1200:*");
    expect(formatPriceRange(0, 2500)).toBe("*:2500");
    expect(formatPriceRange(1200, 2500)).toBe("1200:2500");
    expect(normalizePage(0, -1)).toEqual({ limit: defaultLimit, offset: 0 });
    expect(normalizePage(500, 5)).toEqual({ limit: maxAgentLimit, offset: 5 });
  });

  it("validates search location, radius, and land", () => {
    expect(() => validateSearchRequest({})).toThrow(/city\+state/);
    expect(() => validateSearchRequest({ city: "Seattle", state: "WA" })).not.toThrow();
    expect(() => validateSearchRequest({ intent: intentBuy, zipCode: "98101" })).not.toThrow();
    expect(() => validateSearchRequest({ intent: intentRent, latitude: 47.6, longitude: -122.3 })).not.toThrow();
    expect(() => validateSearchRequest({ intent: intentRent, zipCode: "98101", radius: 200 })).toThrow(/radius max is 100 miles/);
    expect(() => validateSearchRequest({ intent: intentRent, city: "Seattle", state: "WA", propertyType: "land" })).toThrow(/sale-only/);
    expect(() => validateSearchRequest({ intent: intentBuy, city: "Seattle", state: "WA", propertyType: "land" })).not.toThrow();
    expect(summarizeListings([], 0, 10, 0, intentRent)).toContain("No listings");
  });

  it("resolves Seattle presets and zip lists", () => {
    const hill = resolveAreas({ neighborhood: "cap hill" });
    expect(hill.count).toBe(1);
    expect(hill.areas[0]?.name).toBe("Capitol Hill");
    expect((hill.areas[0]?.zips.length ?? 0) >= 1).toBe(true);
    expect(hill.areas[0]?.latitude).not.toBe(0);
    const listed = resolveAreas({ city: "Seattle", state: "WA", listAll: true });
    expect(listed.count).toBeGreaterThanOrEqual(10);
    expect(() => resolveAreas({ neighborhood: "Atlantis" })).toThrow(/unknown neighborhood "Atlantis"/);
    expect(parseZipList("98102, 98122|98102;98118-1234")).toEqual(["98102", "98122", "98118"]);
  });

  it("expands neighborhoods and zip lists into one call", () => {
    const ballard = expandListingsSearch({ neighborhood: "Ballard", newThisWeek: true, petsWanted: true });
    expect(ballard.req.daysOld).toBe("7");
    expect(ballard.req.latitude).not.toBe(0);
    expect(ballard.req.city).toBe("Seattle");
    expect(ballard.req.state).toBe("WA");
    expect(ballard.notes.join(" ")).toMatch(/pet|RentCast/);
    const zips = expandListingsSearch({ city: "Seattle", state: "WA", zipCodes: "98102,98122" });
    expect(zips.req.zipFilter).toHaveLength(2);
    expect(zips.req.zipCode).toBe("");
    expect(zips.notes.join(" ")).toContain("one city+state");
    const multi = expandListingsSearch({ neighborhood: "Ballard, Fremont, Wallingford", priceMax: 2500 });
    expect(multi.req.city).toBe("Seattle");
    expect(multi.req.latitude).toBe(0);
    expect(multi.req.longitude).toBe(0);
    expect((multi.req.zipFilter ?? []).length).toBeGreaterThanOrEqual(2);
    expect(multi.req.zipCode).toBe("");
    expect(multi.notes.join(" ")).toContain("neighborhoods");
    expect(multi.notes.join(" ")).toContain("one");
    expect(filterListingsByZips([
      { id: "a", zipCode: "98102" },
      { id: "b", zipCode: "98101" },
      { id: "c", zipCode: "98122" },
    ], ["98102", "98122"]).map((row) => row.id)).toEqual(["a", "c"]);
  });

  it("builds a Google listing search URL", () => {
    const rent = googleListingSearchURL("902 N 86th St, Seattle, WA 98103", intentRent);
    expect(rent).toContain("google.com/search?q=");
    expect(rent).toContain("rental");
    const buy = googleListingSearchURL("902 N 86th St, Seattle, WA 98103", intentBuy);
    expect(buy.includes("for+sale") || buy.includes("for sale")).toBe(true);
  });

  it("searches rentals over HTTP and keeps handoff fields", async () => {
    let seenKey = "";
    const fetchFn = routeFetch((url, init) => {
      expect(url.pathname).toBe("/listings/rental/long-term");
      seenKey = headerValue(init, "X-Api-Key");
      expect(url.searchParams.get("city")).toBe("Seattle");
      expect(url.searchParams.get("state")).toBe("WA");
      expect(url.searchParams.get("propertyType")).toBe("Apartment");
      expect(url.searchParams.get("price")).toBe("1500:2500");
      expect(url.searchParams.get("daysOld")).toBe("7");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.get("includeTotalCount")).toBe("true");
      return jsonResponse(rentalListings, 200, { "X-Total-Count": "42" });
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "test-key", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn);
    const res = await client.searchListings({
      intent: intentRent,
      city: "Seattle",
      state: "wa",
      propertyType: "apartment",
      priceMin: 1500,
      priceMax: 2500,
      newThisWeek: true,
    }, false);
    expect(seenKey).toBe("test-key");
    expect(res.count).toBe(2);
    expect(res.total).toBe(42);
    expect(res.limit).toBe(10);
    expect(res.intent).toBe(intentRent);
    expect(res.query.intent).toBe(intentRent);
    expect(res.query.state).toBe("WA");
    expect(res.query.property_type).toBe("Apartment");
    expect(res.query.days_old).toBe("7");
    expect(res.query.new_this_week).toBe(true);
    expect(res.summary).toContain("Top picks");
    expect(res.summary).toContain("new this week");
    expect(res.listings[0]?.agent?.phone).toBe("2065550100");
    expect(res.listings[0]?.searchURL).toContain("google.com/search");
    expect(res.listings[0]?.searchURL).toContain("rental");
    expect(res.listings[1]?.office?.website).toBe("https://harbor.example.com/listing/456");
    expect(res.listings[1]?.bedrooms).toBe(0);
    expect(res.usage?.requestsUsed).toBe(1);
  });

  it("filters a neighborhood radius search down to preset zips", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.searchParams.get("latitude")).not.toBe("");
      expect(url.searchParams.get("longitude")).not.toBe("");
      expect(url.searchParams.get("radius")).not.toBe("");
      return jsonResponse([
        { id: "a", formattedAddress: "1 Pike, Seattle, WA 98102", city: "Seattle", state: "WA", zipCode: "98102", bedrooms: 1, bathrooms: 1, price: 2000, daysOnMarket: 2 },
        { id: "b", formattedAddress: "9 Main, Seattle, WA 98101", city: "Seattle", state: "WA", zipCode: "98101", bedrooms: 1, bathrooms: 1, price: 1900, daysOnMarket: 3 },
      ]);
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn);
    const res = await client.searchListings({ intent: intentRent, neighborhood: "Capitol Hill" }, false);
    expect(res.query.neighborhood).toBe("Capitol Hill");
    expect(res.count).toBeGreaterThanOrEqual(1);
    expect(res.listings.every((listing) => listing.zipCode === "98102" || listing.zipCode === "98122")).toBe(true);
  });

  it("defaults an empty intent to the rental catalog and buy to sale", async () => {
    const paths: string[] = [];
    const fetchFn = routeFetch((url) => {
      paths.push(`${url.pathname}?${url.searchParams.toString()}`);
      return jsonResponse([]);
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn);
    const rent = await client.searchListings({ city: "Austin", state: "TX" }, false);
    expect(rent.intent).toBe(intentRent);
    expect(paths[0]?.startsWith("/listings/rental/long-term")).toBe(true);
    const sale = await client.searchListings({ intent: "purchase", city: "Seattle", state: "WA", propertyType: "condo", priceMax: 500000 }, false);
    expect(paths[1]?.startsWith("/listings/sale?")).toBe(true);
    expect(paths[1]).toContain("propertyType=Condo");
    expect(sale.intent).toBe(intentBuy);
  });

  it("rejects a search with no location before calling the network", async () => {
    let hits = 0;
    const fetchFn = routeFetch(() => {
      hits += 1;
      return jsonResponse([]);
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn);
    await expect(client.searchListings({}, false)).rejects.toThrow(/city\+state/);
    expect(hits).toBe(0);
  });

  it("gets a rental and a sale listing", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.startsWith("/listings/rental/long-term/")) {
        return jsonResponse({
          id: "abc",
          formattedAddress: "1 Main St, Portland, OR 97201",
          city: "Portland",
          state: "OR",
          zipCode: "97201",
          propertyType: "Condo",
          bedrooms: 2,
          bathrooms: 2,
          price: 2400,
          status: "Active",
        });
      }
      expect(url.pathname).toBe("/listings/sale/sale-id");
      return jsonResponse({
        id: "sale-id",
        formattedAddress: "9 Elm St, Denver, CO 80202",
        city: "Denver",
        state: "CO",
        price: 610000,
        propertyType: "Single Family",
      });
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn);
    const rental = await client.getListing("abc", intentRent, false);
    expect(rental.listing.city).toBe("Portland");
    expect(rental.listing.price).toBe(2400);
    expect(rental.usage?.requestsUsed).toBe(1);
    const sale = await client.getListing("sale-id", intentBuy, false);
    expect(sale.listing.intent).toBe(intentBuy);
    expect(sale.listing.price).toBe(610000);
    expect(sale.listing.searchURL.includes("for+sale") || sale.listing.searchURL.includes("for sale")).toBe(true);
    await expect(client.getListing("  ", intentRent, false)).rejects.toThrow(/listing id is required/);
  });

  it("estimates rent and reads market stats", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname === "/avm/rent/long-term") {
        expect(url.searchParams.get("propertyType")).toBe("Single Family");
        return jsonResponse({
          rent: 2750,
          rentRangeLow: 2500,
          rentRangeHigh: 3000,
          subjectProperty: {
            formattedAddress: "9 Elm St, Denver, CO 80202",
            propertyType: "Single Family",
            bedrooms: 3,
            bathrooms: 2,
          },
        });
      }
      expect(url.pathname).toBe("/markets");
      expect(url.searchParams.get("zipCode")).toBe("98101");
      expect(url.searchParams.get("dataType")).toBe("Rental");
      return jsonResponse({
        zipCode: "98101",
        rentalData: {
          averageRent: 2600,
          medianRent: 2450,
          minRent: 1200,
          maxRent: 5000,
          totalListings: 120,
          newListings: 18,
          averageDaysOnMarket: 22.5,
          medianDaysOnMarket: 10,
          dataByPropertyType: [{ propertyType: "Apartment", averageRent: 2300, medianRent: 2200, totalListings: 80 }],
        },
      });
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, fetchFn);
    const estimate = await client.rentEstimate({ address: "9 Elm St, Denver, CO 80202", propertyType: "house", bedrooms: "3" }, false);
    expect(estimate.rentEstimate).toBe(2750);
    expect(estimate.address).toBe("9 Elm St, Denver, CO 80202");
    const market = await client.marketStats("98101", false);
    expect(market.medianRent).toBe(2450);
    expect(market.byPropertyType).toHaveLength(1);
  });

  it("surfaces HTTP failures and redacts the API key", async () => {
    const ctx = pluginCtx({
      RENTCAST_API_KEY: "super-secret",
      RENTCAST_BASE_URL: "https://rentcast.test",
    }, routeFetch(() => jsonResponse("{\"message\":\"nope\"}\n", 401)));
    const client = clientFromEnv(ctx.env, ctx.sql, ctx.clock, ctx.fetch);
    await expect(client.marketStats("98101", false)).rejects.toThrow(/401/);
    const boom = pluginCtx({
      RENTCAST_API_KEY: "super-secret",
      RENTCAST_BASE_URL: "https://rentcast.test",
    }, () => Promise.reject(new Error("network super-secret failed")));
    const failing = clientFromEnv(boom.env, boom.sql, boom.clock, boom.fetch);
    await expect(failing.marketStats("98101", false)).rejects.toThrow(/\[redacted\]/);
    await expect(failing.marketStats("98101", false)).rejects.not.toThrow(/super-secret/);
  });

  it("blocks hard and soft caps before any HTTP call", async () => {
    let hits = 0;
    const fetchFn = routeFetch(() => {
      hits += 1;
      return jsonResponse({ zipCode: "98101" });
    });
    const hardCtx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const hardUsage = usageTracker(hardCtx.env, hardCtx.sql, hardCtx.clock);
    for (let i = 0; i < 50; i += 1) {
      hardUsage.recordSuccess();
    }
    const hard = createClient({ apiKey: "k", baseURL: "https://rentcast.test", fetch: fetchFn, usage: hardUsage });
    await expect(hard.marketStats("98101", true)).rejects.toBeInstanceOf(QuotaError);
    expect(hits).toBe(0);
    const softCtx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const softUsage = usageTracker(softCtx.env, softCtx.sql, softCtx.clock);
    for (let i = 0; i < 40; i += 1) {
      softUsage.recordSuccess();
    }
    const soft = createClient({ apiKey: "k", baseURL: "https://rentcast.test", fetch: fetchFn, usage: softUsage });
    await expect(soft.marketStats("98101", false)).rejects.toThrow(/confirm_spend=true/);
    expect(hits).toBe(0);
    await soft.marketStats("98101", true);
    expect(hits).toBe(1);
    expect(softUsage.snapshot()?.requestsUsed).toBe(41);
  });

  it("tracks usage in SQL across trackers, caps, and month reset", () => {
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k" });
    const tracker = usageTracker(ctx.env, ctx.sql, ctx.clock);
    tracker.recordSuccess();
    tracker.recordSuccess();
    const snap = tracker.snapshot();
    expect(snap?.requestsUsed).toBe(2);
    expect(snap?.requestsLeft).toBe(48);
    expect(snap?.persistent).toBe(true);
    expect(snap?.softCap).toBe(40);
    expect(snap?.capState).toBe("ok");
    expect(snap?.period).toBe("2026-10");
    expect(snap?.periodResets).toBe("2026-11-01");
    const reloaded = usageTracker(ctx.env, ctx.sql, ctx.clock);
    expect(reloaded.snapshot()?.requestsUsed).toBe(2);

    const disabled = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_USAGE_TRACK: "0" });
    const off = usageTracker(disabled.env, disabled.sql, disabled.clock);
    off.recordSuccess();
    expect(off.snapshot()).toBeNull();
    expect(off.gate(false)).toBeNull();

    const quotaCtx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_MONTHLY_QUOTA: "10" });
    const quota = usageTracker(quotaCtx.env, quotaCtx.sql, quotaCtx.clock);
    quota.recordSuccess();
    quota.recordSuccess();
    quota.recordSuccess();
    expect(quota.snapshot()?.requestsPerMonth).toBe(10);
    expect(quota.snapshot()?.requestsLeft).toBe(7);
    expect(quota.snapshot()?.softCap).toBe(0);

    const softCtx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_SOFT_CAP: "5" });
    const soft = usageTracker(softCtx.env, softCtx.sql, softCtx.clock);
    for (let i = 0; i < 5; i += 1) {
      soft.recordSuccess();
    }
    expect(soft.snapshot()?.capState).toBe("confirm_required");
    expect(soft.snapshot()?.confirmRequired).toBe(true);

    const overCtx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_ALLOW_OVERAGE: "1" });
    const over = usageTracker(overCtx.env, overCtx.sql, overCtx.clock);
    for (let i = 0; i < 50; i += 1) {
      over.recordSuccess();
    }
    expect(over.gate(false)).toBeNull();
    expect(over.snapshot()?.capState).toBe("overage");
    expect(over.snapshot()?.hardCapped).toBe(false);

    const gateCtx = pluginCtx({ RENTCAST_API_KEY: "k" });
    const gate = usageTracker(gateCtx.env, gateCtx.sql, gateCtx.clock);
    for (let i = 0; i < 40; i += 1) {
      gate.recordSuccess();
    }
    const softErr = gate.gate(false);
    expect(softErr).toBeInstanceOf(QuotaError);
    expect(softErr?.kind).toBe("soft");
    expect(softErr?.message).toContain("confirm_spend=true");
    expect(gate.gate(true)).toBeNull();
    for (let i = 0; i < 10; i += 1) {
      gate.recordSuccess();
    }
    const hardErr = gate.gate(true);
    expect(hardErr?.kind).toBe("hard");
    expect(hardErr?.message).toContain("RENTCAST_ALLOW_OVERAGE=1");
    expect(gate.snapshot()?.requestsUsed).toBe(50);
    expect(gate.snapshot()?.capState).toBe("exhausted");

    const resetCtx = pluginCtx({ RENTCAST_API_KEY: "k" });
    usageTracker(resetCtx.env, resetCtx.sql, resetCtx.clock);
    resetCtx.sql.exec("INSERT INTO rentals_usage (id, period, count) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET period = excluded.period, count = excluded.count", "2020-01", 50);
    const reset = usageTracker(resetCtx.env, resetCtx.sql, resetCtx.clock);
    expect(reset.gate(false)).toBeNull();
    const resetSnap = reset.snapshot();
    expect(resetSnap?.requestsUsed).toBe(0);
    expect(resetSnap?.period).toBe("2026-10");
    expect(resetSnap?.capState).toBe("ok");
  });

  it("serves free tools and billed tools through the plugin", async () => {
    const ctx = pluginCtx({});
    const missing = await toolNamed(ctx, "listings_search").call({ intent: "rent", zip_code: "98101" }, call);
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("client not configured");
    const missingId = await toolNamed(ctx, "listings_get").call({}, call);
    expect(textOf(missingId)).toBe("listing_id is required");

    const link = await toolNamed(ctx, "link_format").call({
      intent: "rent",
      city: "Seattle",
      state: "WA",
      neighborhood: "Ballard",
      pets_wanted: true,
    }, call);
    expect(link.isError).toBeUndefined();
    const linkBody = textOf(link);
    expect(linkBody).toContain("zillow.com");
    expect(linkBody).toContain("for_rent");
    expect(linkBody).toContain("pets=true");
    expect(linkBody.startsWith("[{\"intent\":")).toBe(true);
    const buy = await toolNamed(ctx, "link_format").call({ intent: "purchase", city: "Seattle", state: "WA" }, call);
    expect(textOf(buy)).toContain("for_sale");
    const rentLink = await toolNamed(ctx, "link_format").call({ city: "Seattle", state: "WA" }, call);
    expect(textOf(rentLink)).toContain("\"intent\":\"rent\"");
    expect(textOf(rentLink)).toContain("for_rent");

    const areas = await toolNamed(ctx, "areas_resolve").call({ neighborhood: "u district" }, call);
    const areasBody = JSON.parse(textOf(areas)) as { count: number; areas: { name: string }[] }[];
    expect(areasBody[0]?.count).toBe(1);
    expect(areasBody[0]?.areas[0]?.name).toBe("University District");

    const bare = await toolNamed(ctx, "account_get").call({}, call);
    expect(textOf(bare).startsWith("{\"dashboard_url\":")).toBe(true);
    expect(textOf(bare)).not.toContain("\"usage\"");

    let hits = 0;
    const fetchFn = routeFetch((url) => {
      hits += 1;
      if (url.pathname === "/listings/sale/abc") {
        return jsonResponse({ id: "abc", formattedAddress: "1 Main, Austin, TX", price: 10, status: "Active" });
      }
      return jsonResponse([]);
    });
    const live = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const search = await toolNamed(live, "listings_search").call({
      intent: "rent",
      city: "Austin",
      state: "TX",
      property_type: "house",
      price_max: 3000,
      limit: 5,
    }, call);
    const searchBody = JSON.parse(textOf(search)) as { limit: number; query: { property_type: string }; intent: string };
    expect(searchBody.limit).toBe(5);
    expect(searchBody.query.property_type).toBe("Single Family");
    expect(searchBody.intent).toBe("rent");

    const multi = await toolNamed(live, "listings_search").call({
      intent: "buy",
      city: "Austin",
      state: "TX",
      property_type: "house,condo",
    }, call);
    const multiBody = JSON.parse(textOf(multi)) as { query: { property_type: string; intent: string }; intent: string };
    expect(multiBody.query.property_type).toBe("Single Family|Condo");
    expect(multiBody.intent).toBe("buy");
    expect(multiBody.query.intent).toBe("buy");

    const got = await toolNamed(live, "listings_get").call({ listing_id: "abc", intent: "buy" }, call);
    const gotBody = JSON.parse(textOf(got)) as { id: string; intent: string }[];
    expect(gotBody[0]?.id).toBe("abc");
    expect(gotBody[0]?.intent).toBe("buy");
    const defaultGet = await toolNamed(live, "listings_get").call({ listing_id: "abc" }, call);
    expect((JSON.parse(textOf(defaultGet)) as { intent: string }[])[0]?.intent).toBe("rent");

    const neighborhood = await toolNamed(live, "listings_search").call({
      intent: "rent",
      neighborhood: "Fremont",
      new_this_week: true,
      pets_wanted: true,
    }, call);
    const neighborhoodBody = JSON.parse(textOf(neighborhood)) as { query: { days_old: string; neighborhood: string }; note: string };
    expect(neighborhoodBody.query.days_old).toBe("7");
    expect(neighborhoodBody.query.neighborhood).toBe("Fremont");
    expect(neighborhoodBody.note).toContain("RentCast");

    await toolNamed(live, "markets_get").call({ zip_code: "97201" }, call);
    await toolNamed(live, "rent_estimate_get").call({ address: "1 Main St, Portland, OR 97201" }, call);
    const account = JSON.parse(textOf(await toolNamed(live, "account_get").call({}, call))) as {
      provider: string;
      note: string;
      usage: { requests_per_month: number; soft_cap: number; cap_state: string };
    };
    expect(account.provider).toBe("RentCast");
    expect(account.note).toContain("confirm_spend");
    expect(account.note).toContain("Hard cap");
    expect(account.usage.requests_per_month).toBe(50);
    expect(account.usage.soft_cap).toBe(40);
    expect(account.usage.cap_state).toBe("ok");

    const seeded = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const seed = usageTracker(seeded.env, seeded.sql, seeded.clock);
    for (let i = 0; i < 40; i += 1) {
      seed.recordSuccess();
    }
    const before = hits;
    const blocked = await toolNamed(seeded, "listings_search").call({ intent: "rent", city: "Seattle", state: "WA" }, call);
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain("confirm_spend=true");
    expect(hits).toBe(before);
    const allowed = await toolNamed(seeded, "listings_search").call({
      intent: "rent",
      city: "Seattle",
      state: "WA",
      confirm_spend: true,
    }, call);
    expect(allowed.isError).toBeUndefined();
    expect(hits).toBe(before + 1);

    const hardCtx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const hardSeed = usageTracker(hardCtx.env, hardCtx.sql, hardCtx.clock);
    for (let i = 0; i < 50; i += 1) {
      hardSeed.recordSuccess();
    }
    const hardHits = hits;
    const hard = await toolNamed(hardCtx, "listings_search").call({
      intent: "rent",
      city: "Seattle",
      state: "WA",
      confirm_spend: true,
    }, call);
    expect(hard.isError).toBe(true);
    expect(textOf(hard)).toContain("HARD CAP");
    expect(textOf(hard)).toContain("RENTCAST_ALLOW_OVERAGE=1");
    expect(hits).toBe(hardHits);
  });

  it("batches listing ids, addresses, zips, and neighborhood names", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.startsWith("/listings/")) {
        const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (id === "missing") {
          return jsonResponse({ message: "nope" }, 404);
        }
        return jsonResponse({ id, formattedAddress: "1 Main", price: 10, status: "Active" });
      }
      if (url.pathname === "/avm/rent/long-term") {
        return jsonResponse({ rent: 1000, subjectProperty: { formattedAddress: url.searchParams.get("address") } });
      }
      return jsonResponse({ zipCode: url.searchParams.get("zipCode"), rentalData: { medianRent: 1 } });
    });
    const ctx = pluginCtx({ RENTCAST_API_KEY: "k", RENTCAST_BASE_URL: "https://rentcast.test" }, fetchFn);
    const listed = JSON.parse(textOf(await toolNamed(ctx, "listings_get").call({ ids: ["abc", "missing"] }, call))) as { id?: string; error?: string }[];
    expect(listed[0]?.id).toBe("abc");
    expect(listed[1]?.error).toContain("404");
    const estimates = JSON.parse(textOf(await toolNamed(ctx, "rent_estimate_get").call({
      addresses: ["1 Main St, Portland, OR 97201", "2 Main St, Portland, OR 97201"],
    }, call))) as { address: string }[];
    expect(estimates.map((row) => row.address)).toEqual([
      "1 Main St, Portland, OR 97201",
      "2 Main St, Portland, OR 97201",
    ]);
    const markets = JSON.parse(textOf(await toolNamed(ctx, "markets_get").call({ zips: ["98101", "98102"] }, call))) as { zip_code: string }[];
    expect(markets.map((row) => row.zip_code)).toEqual(["98101", "98102"]);
    const areas = JSON.parse(textOf(await toolNamed(ctx, "areas_resolve").call({ names: ["Ballard", "nope"] }, call))) as { name: string; count?: number; error?: string }[];
    expect(areas[0]).toMatchObject({ name: "Ballard", count: 1 });
    expect(areas[1]?.error).toContain("unknown neighborhood");
    expect(rentals.tools(ctx).find((tool) => tool.name === "account_get")?.single).toContain("RentCast");
  });
});

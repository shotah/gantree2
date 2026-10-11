import { describe, expect, it } from "vitest";
import { fixedClock, makeLogger, memorySink } from "@/brain/core";
import type { CallContext, PluginContext } from "@/brain/core/tools";
import { getBookingOptions } from "@/brain/plugins/flights/booking";
import { clientFrom, getJSON } from "@/brain/plugins/flights/client";
import {
  applyAirlineParams,
  applyFlyAmerica,
  classifyFlyAmerica,
  detectRefundable,
  FlyAmericaForeign,
  FlyAmericaOK,
  marketingCodeFromFlightNumber,
  RefundableNo,
  RefundableUnknown,
  RefundableYes,
  resolveAirlineList,
} from "@/brain/plugins/flights/filters";
import { flights } from "@/brain/plugins/flights";
import {
  normalizePriceHistory,
  offerParams,
  parseSort,
  parseStops,
  parseTravelClass,
  recommendOffers,
  sampleDates,
  sampleDateStayPlans,
  searchAirports,
  searchDates,
  searchOffersWithUsage,
  selectDeparture,
  summarizeOffer,
  validateOfferRequest,
} from "@/brain/plugins/flights/search";
import type { FlightOffer, OfferSearchResult } from "@/brain/plugins/flights/types";
import { buildGoogleFlightsURL } from "@/brain/plugins/flights/url";
import { ACCOUNT_GET_DESCRIPTION, TOOL_NAMES } from "@/brain/plugins/flights/schema";

const call: CallContext = { userId: "u", sessionId: "s" };

function queryUnescape(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const accountBody = {
  plan_name: "Free Plan",
  searches_per_month: 250,
  plan_searches_left: 249,
  total_searches_left: 249,
  this_month_usage: 1,
  plan_renewal_date: "2026-09-01",
};

function routeFetch(handler: (url: URL) => Response): typeof fetch {
  return (input) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(new URL(href)));
  };
}

function pluginCtx(env: Record<string, string>, fetchFn: typeof fetch): PluginContext {
  return {
    env,
    sql: { exec: () => [], one: () => null, changes: () => 0 },
    clock: fixedClock(Date.UTC(2026, 9, 11), "UTC"),
    log: makeLogger(memorySink(), () => 0),
    fetch: fetchFn,
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  };
}

function textOf(result: { content: { type: string; text?: string }[]; isError?: boolean }): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text ?? "" : "";
}

describe("flights plugin", () => {
  it("publishes the Go tool list", () => {
    const ctx = pluginCtx({}, routeFetch(() => jsonResponse({})));
    expect(flights.name).toBe("flights");
    const tools = flights.tools(ctx);
    expect(tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const name of tools.map((tool) => tool.name)) {
      expect(name.startsWith("flights_")).toBe(false);
      expect(name.split("_").length).toBeGreaterThanOrEqual(2);
    }
    const offers = tools[0];
    expect(offers?.description.startsWith("Search Google Flights prices")).toBe(true);
    expect(offers?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["origin", "destination", "outbound_date"],
    });
    const properties = offers?.inputSchema.properties as Record<string, { type: string; description: string }>;
    expect(properties.origin).toEqual({
      type: "string",
      description: "Departure airport IATA code or Google location id (e.g. SEA or /m/0d9jr)",
    });
    const accountTool = tools.find((tool) => tool.name === "account_get");
    expect(accountTool?.description).toBe(ACCOUNT_GET_DESCRIPTION);
    expect(accountTool?.inputSchema).toEqual({ type: "object", additionalProperties: false });
    expect(accountTool?.single).toContain("SerpAPI");
    expect(tools.find((tool) => tool.name === "returns_search")?.single).toContain("departure_token");
  });

  it("joins alternate airports, lists prefixes and booking tokens, and returns one link per date", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      if (url.searchParams.get("engine") === "google_flights_autocomplete") {
        return jsonResponse({ suggestions: [{ name: url.searchParams.get("q"), id: "SEA", type: "city" }] });
      }
      if (url.searchParams.get("booking_token") === "bad") {
        return jsonResponse({ error: "expired" });
      }
      if (url.searchParams.get("booking_token")) {
        return jsonResponse({
          search_parameters: { currency: "USD" },
          booking_options: [{ together: { book_with: "Alaska", price: 10, option_title: "Main", booking_request: { url: "https://example.test/book" } } }],
        });
      }
      expect(url.searchParams.get("departure_id")).toBe("SEA,PDX");
      expect(url.searchParams.get("arrival_id")).toBe("SFO");
      return jsonResponse({ best_flights: [] });
    });
    const ctx = pluginCtx({ SERPAPI_API_KEY: "k", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn);
    const tools = flights.tools(ctx);
    const offers = await tools.find((tool) => tool.name === "offers_search")?.call({
      origins: ["SEA", "PDX"],
      destination: "SFO",
      outbound_date: "2026-09-01",
    }, call);
    expect(offers?.isError).toBeUndefined();
    const offerBody = JSON.parse(textOf(offers ?? { content: [] })) as { origin: string; offers: unknown[] };
    expect(offerBody.origin).toBe("SEA,PDX");
    expect(Array.isArray(offerBody.offers)).toBe(true);

    const airports = await tools.find((tool) => tool.name === "airports_search")?.call({
      queries: ["Sea", "Port"],
    }, call);
    const airportRows = JSON.parse(textOf(airports ?? { content: [] })) as { query: string; error?: string }[];
    expect(airportRows.map((row) => row.query)).toEqual(["Sea", "Port"]);
    expect(airportRows[0]?.error).toBeUndefined();

    const booking = await tools.find((tool) => tool.name === "booking_options_get")?.call({
      ids: ["good", "bad"],
    }, call);
    const bookingRows = JSON.parse(textOf(booking ?? { content: [] })) as { booking_token: string; error?: string; options?: unknown[] }[];
    expect(bookingRows[0]?.booking_token).toBe("good");
    expect(bookingRows[0]?.options).toBeDefined();
    expect(bookingRows[1]?.booking_token).toBe("bad");
    expect(bookingRows[1]?.error).toContain("serpapi");

    const links = await tools.find((tool) => tool.name === "link_format")?.call({
      origin: "SEA",
      destination: "SFO",
      outbound_dates: ["2026-09-01", "2026-09-02"],
    }, call);
    const linkRows = JSON.parse(textOf(links ?? { content: [] })) as { google_flights_url: string }[];
    expect(linkRows).toHaveLength(2);
    expect(linkRows[1]?.google_flights_url).toContain("2026-09-02");
  });

  it("is no_key without SERPAPI_API_KEY and ready with one", async () => {
    const fetchFn = routeFetch(() => jsonResponse({}));
    expect(await flights.ready(pluginCtx({}, fetchFn))).toBe("no_key");
    expect(await flights.ready(pluginCtx({ SERPAPI_API_KEY: "  " }, fetchFn))).toBe("no_key");
    expect(await flights.ready(pluginCtx({ SERPAPI_API_KEY: "k" }, fetchFn))).toBeNull();
  });

  it("formats a fallback search link without a key", async () => {
    const tool = flights.tools(pluginCtx({}, routeFetch(() => jsonResponse({})))).find((item) => item.name === "link_format");
    const ok = await tool?.call({ origin: "sea", destination: "cdg", outbound_date: "2026-09-01" }, call);
    expect(ok?.isError).toBeUndefined();
    const parsed = JSON.parse(textOf(ok ?? { content: [] })) as { google_flights_url: string; note: string }[];
    expect(parsed[0]).toMatchObject({
      note: "Fallback search URL only. Prefer booking_options_get for real checkout. This MCP never purchases tickets.",
    });
    const url = parsed[0]?.google_flights_url ?? "";
    expect(url).toContain("q=");
    expect(url).toContain("SEA");
    const missing = await tool?.call({}, call);
    expect(missing?.isError).toBe(true);
    expect(textOf(missing ?? { content: [] })).toBe("origin, destination, and outbound_date are required");
  });
});

describe("google flights url", () => {
  it("builds a round-trip q= link", () => {
    const got = buildGoogleFlightsURL({
      origin: "sea",
      destination: "cdg",
      outboundDate: "2026-09-01",
      returnDate: "2026-09-10",
      currency: "USD",
      country: "us",
      language: "en",
    });
    expect(got).toContain("https://www.google.com/travel/flights?");
    expect(got).toContain("q=");
    expect(got).toContain("SEA");
    expect(got).toContain("CDG");
    expect(got).toContain("through");
    expect(got).not.toContain("#flt=");
  });

  it("builds a one-way link", () => {
    const got = buildGoogleFlightsURL({ origin: "JFK", destination: "LAX", outboundDate: "2026-08-15" });
    const decoded = queryUnescape(got);
    expect(decoded).toContain("Flights from JFK to LAX on 2026-08-15");
    expect(decoded).not.toContain("through");
  });
});

describe("flight search helpers", () => {
  it("parses class, stops, and sort", () => {
    expect(parseTravelClass("business")).toBe(3);
    expect(() => parseTravelClass("coach")).toThrow(/travel_class/);
    expect(parseStops("nonstop")).toBe(1);
    expect(parseSort("price")).toBe(2);
  });

  it("samples dates across a window", () => {
    const start = new Date(Date.UTC(2026, 7, 1));
    const end = new Date(Date.UTC(2026, 7, 10));
    const got = sampleDates(start, end, 3);
    expect(got).toHaveLength(3);
    expect(got[0]?.getTime()).toBe(start.getTime());
    expect(got[2]?.getTime()).toBe(end.getTime());
  });

  it("spreads stay lengths", () => {
    const plans = sampleDateStayPlans(new Date(Date.UTC(2026, 7, 1)), new Date(Date.UTC(2026, 7, 14)), 4, 7, 7);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.length).toBeLessThanOrEqual(7);
    const stays = new Set(plans.map((plan) => plan.stayNights));
    for (const plan of plans) {
      expect(plan.stayNights).toBeGreaterThanOrEqual(4);
      expect(plan.stayNights).toBeLessThanOrEqual(7);
    }
    expect(stays.size).toBeGreaterThanOrEqual(2);
  });

  it("validates offer requests", () => {
    expect(() => validateOfferRequest({ origin: "", destination: "", outboundDate: "" })).toThrow(/origin and destination/);
    expect(() => validateOfferRequest({ origin: "SEA", destination: "CDG", outboundDate: "not-a-date" })).toThrow(/outbound_date/);
  });

  it("normalizes price history", () => {
    const got = normalizePriceHistory([[1691013600, 575], [1691100000, 600], [1]]);
    expect(got).toEqual([{ timestamp: 1691013600, price: 575 }, { timestamp: 1691100000, price: 600 }]);
  });

  it("summarizes and prefers a near nonstop", () => {
    const res: OfferSearchResult = {
      tripType: "one_way",
      origin: "SEA",
      destination: "SFO",
      outboundDate: "2026-09-01",
      currency: "USD",
      googleFlightsUrl: "https://www.google.com/travel/flights?x=1",
      priceInsights: { priceLevel: "high", typicalPriceLow: 180, typicalPriceHigh: 260 },
      offers: [
        {
          price: 200,
          currency: "USD",
          stops: 1,
          airlines: ["Delta"],
          departureAirport: "SEA",
          arrivalAirport: "SFO",
          departureTime: "08:00",
          arrivalTime: "10:30",
          totalDurationMin: 150,
          layovers: ["PDX (40m)"],
        },
        {
          price: 220,
          currency: "USD",
          stops: 0,
          airlines: ["Alaska"],
          departureAirport: "SEA",
          arrivalAirport: "SFO",
          departureTime: "09:00",
          arrivalTime: "11:00",
          totalDurationMin: 120,
        },
      ],
    };
    for (const offer of res.offers) {
      offer.summary = summarizeOffer(offer);
    }
    expect(res.offers[0]?.summary).toContain("1 stop");
    expect(res.offers[0]?.summary).toContain("200 USD");
    const rec = recommendOffers(res);
    expect(rec).toContain("Alaska");
    expect(rec).toContain("expensive");
  });
});

describe("airline filters", () => {
  it("expands presets", () => {
    expect(resolveAirlineList("alaska_partners")).toBe("AS,ONEWORLD");
    expect(resolveAirlineList("delta,UA")).toBe("DL,SKYTEAM,UA");
  });

  it("rejects combining include and exclude", () => {
    expect(() => applyAirlineParams("AS", "DL")).toThrow(/cannot be used together/);
    expect(applyAirlineParams("ONEWORLD", "")).toEqual({ inc: "ONEWORLD", exc: "" });
  });

  it("reads marketing codes", () => {
    const cases: Record<string, string> = {
      B6101: "B6",
      "AS 123": "AS",
      DL123: "DL",
      "9E4800": "9E",
      "": "",
      JetBlue: "",
    };
    for (const [input, want] of Object.entries(cases)) {
      expect(marketingCodeFromFlightNumber(input)).toBe(want);
    }
  });

  it("classifies fly america", () => {
    const ok: FlightOffer = {
      price: 1,
      stops: 1,
      flights: [
        { airline: "Delta", flightNumber: "DL100" },
        { airline: "Delta", flightNumber: "DL200" },
      ],
    };
    const classified = classifyFlyAmerica(ok);
    expect(classified.status).toBe(FlyAmericaOK);
    expect(classified.codes).toEqual(["DL"]);
    const foreign = classifyFlyAmerica({
      price: 1,
      stops: 0,
      flights: [{ airline: "Air France", flightNumber: "AF83" }],
    });
    expect(foreign.status).toBe(FlyAmericaForeign);
  });

  it("filters foreign marketing carriers and notes open skies", () => {
    const out: OfferSearchResult = {
      tripType: "one_way",
      origin: "SEA",
      destination: "CDG",
      outboundDate: "2026-09-01",
      currency: "USD",
      offers: [
        { price: 500, stops: 0, flights: [{ flightNumber: "DL1" }] },
        { price: 400, stops: 0, flights: [{ flightNumber: "AF1" }] },
      ],
    };
    applyFlyAmerica(out, "filter", "civilian");
    expect(out.offers).toHaveLength(1);
    expect(out.offers[0]?.flyAmericaStatus).toBe(FlyAmericaOK);
    expect(out.complianceNote).toBeTruthy();
    expect(out.openSkiesHint).toContain("Open Skies");
  });

  it("detects refundable text", () => {
    expect(detectRefundable("Basic", ["No refunds"])).toBe(RefundableNo);
    expect(detectRefundable("Refundable Economy", [])).toBe(RefundableYes);
    expect(detectRefundable("Main Cabin", ["Free seat"])).toBe(RefundableUnknown);
  });

  it("sets include_airlines and exclude_basic", () => {
    const params = offerParams({
      origin: "SEA",
      destination: "SFO",
      outboundDate: "2026-09-01",
      includeAirlines: "alaska_partners",
      excludeBasic: true,
    });
    expect(params.include_airlines).toBe("AS,ONEWORLD");
    expect(params.exclude_basic).toBe("true");
  });
});

describe("serpapi http", () => {
  it("requires a key and trims the base url", () => {
    expect(clientFrom({}, fetch).apiKey).toBe("");
    const client = clientFrom({ SERPAPI_API_KEY: "k", SERPAPI_BASE_URL: "http://example.test/" }, fetch);
    expect(client.baseURL).toBe("http://example.test");
    expect(client.apiKey).toBe("k");
  });

  it("reports HTTP errors", async () => {
    const fetchFn = routeFetch(() => jsonResponse({ error: "Invalid API key" }, 400));
    const client = clientFrom({ SERPAPI_API_KEY: "bad", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn);
    await expect(getJSON(client, "/search.json", null)).rejects.toThrow(/400/);
  });

  it("searches offers and attaches usage", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      expect(url.searchParams.get("engine")).toBe("google_flights");
      return jsonResponse({
        search_metadata: { google_flights_url: "https://www.google.com/travel/flights?demo=1" },
        search_parameters: { currency: "USD" },
        best_flights: [{
          price: 199,
          total_duration: 360,
          flights: [{
            departure_airport: { id: "JFK", time: "2026-08-15 08:00" },
            arrival_airport: { id: "LAX", time: "2026-08-15 11:00" },
            duration: 360,
            airline: "JetBlue",
            flight_number: "B6101",
            travel_class: "Economy",
          }],
        }],
        price_insights: { lowest_price: 199, price_level: "low", typical_price_range: [220, 310] },
      });
    });
    const res = await searchOffersWithUsage(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      { origin: "JFK", destination: "LAX", outboundDate: "2026-08-15", sortBy: "price", maxResults: 5 },
    );
    expect(res.offers).toHaveLength(1);
    expect(res.offers[0]?.price).toBe(199);
    expect(res.priceInsights?.priceLevel).toBe("low");
    expect(res.recommendation).toContain("199");
    expect(res.usage?.searchesLeft).toBe(249);
  });

  it("resolves airports", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      expect(url.searchParams.get("engine")).toBe("google_flights_autocomplete");
      return jsonResponse({
        suggestions: [{
          name: "Seattle",
          type: "city",
          id: "/m/0d9jr",
          airports: [{ name: "Seattle-Tacoma International Airport", id: "SEA", city: "Seattle" }],
        }],
      });
    });
    const res = await searchAirports(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      "Seattle",
      "us",
      "en",
    );
    expect(res.suggestions[0]?.airports?.[0]?.id).toBe("SEA");
  });

  it("samples one-way dates", async () => {
    let calls = 0;
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      calls += 1;
      return jsonResponse({
        best_flights: [{
          price: 100 + calls,
          flights: [{
            departure_airport: { id: "SEA", time: "08:00" },
            arrival_airport: { id: "SFO", time: "10:00" },
            airline: "Alaska",
          }],
        }],
      });
    });
    const res = await searchDates(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      { origin: "SEA", destination: "SFO", startDate: "2026-09-01", endDate: "2026-09-05", currency: "USD", stops: "any", maxSamples: 3 },
    );
    expect(calls).toBe(3);
    expect(res.tripType).toBe("one_way");
    expect(res.cheapestDate).toBeTruthy();
    expect(res.cheapestPrice).toBeGreaterThan(0);
  });

  it("samples round-trip stays", async () => {
    const returnDates: string[] = [];
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      returnDates.push(url.searchParams.get("return_date") ?? "");
      return jsonResponse({
        best_flights: [{
          price: 450,
          total_duration: 800,
          flights: [{
            departure_airport: { id: "SEA", time: "08:00" },
            arrival_airport: { id: "NRT", time: "11:00" },
            airline: "ANA",
          }],
        }],
      });
    });
    const res = await searchDates(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      { origin: "SEA", destination: "NRT", startDate: "2026-10-01", endDate: "2026-10-03", stayNights: 7, currency: "USD", maxSamples: 2 },
    );
    expect(res.tripType).toBe("round_trip");
    expect(res.stayNights).toBe(7);
    expect(returnDates[0]).toBe("2026-10-08");
    expect(returnDates).toHaveLength(2);
    expect(res.cheapestReturn).toBeTruthy();
    expect(res.recommendation).toContain("round-trip");
  });

  it("loads booking options", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      expect(url.searchParams.get("booking_token")).toBe("tok123");
      return jsonResponse({
        search_parameters: { currency: "USD" },
        booking_options: [{
          together: {
            book_with: "Alaska Airlines",
            airline: true,
            price: 220,
            option_title: "Main Cabin",
            marketed_as: ["AS 123"],
            booking_request: { url: "https://www.google.com/travel/clk/f", post_data: "u=abc" },
          },
        }],
      });
    });
    const res = await getBookingOptions(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      { bookingToken: "tok123", currency: "USD", country: "us", language: "en" },
    );
    expect(res.options).toHaveLength(1);
    expect(res.options[0]?.bookWith).toBe("Alaska Airlines");
    expect(res.options[0]?.booking?.method).toBe("POST");
    expect(res.recommendation).toContain("checkout");
  });

  it("requires a booking token", async () => {
    const client = clientFrom({ SERPAPI_API_KEY: "test" }, fetch);
    await expect(getBookingOptions(client, { bookingToken: "" })).rejects.toThrow(/booking_token is required/);
  });

  it("keeps refundable options", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      return jsonResponse({
        search_parameters: { currency: "USD" },
        booking_options: [
          {
            together: {
              book_with: "Airline A",
              price: 100,
              option_title: "Basic Economy",
              extensions: ["No refunds"],
              booking_request: { url: "https://example.com/a" },
            },
          },
          {
            together: {
              book_with: "Airline B",
              price: 180,
              option_title: "Refundable Economy",
              extensions: ["Refundable"],
              booking_request: { url: "https://example.com/b" },
            },
          },
        ],
      });
    });
    const res = await getBookingOptions(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      { bookingToken: "tok", refundableOnly: true },
    );
    expect(res.options).toHaveLength(1);
    expect(res.options[0]?.refundable).toBe(RefundableYes);
    expect(res.recommendation).toContain("refundable");
  });

  it("selects a departure token", async () => {
    const fetchFn = routeFetch((url) => {
      if (url.pathname.endsWith("/account.json")) {
        return jsonResponse(accountBody);
      }
      expect(url.searchParams.get("departure_token")).toBeTruthy();
      return jsonResponse({
        best_flights: [{
          price: 500,
          booking_token: "book-me",
          total_duration: 400,
          flights: [{
            departure_airport: { id: "NRT", time: "10:00" },
            arrival_airport: { id: "SEA", time: "14:00" },
            airline: "ANA",
          }],
        }],
      });
    });
    const res = await selectDeparture(
      clientFrom({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn),
      "dep-tok",
      "USD",
      "us",
      "en",
    );
    expect(res.offers[0]?.bookingToken).toBe("book-me");
    expect(res.recommendation).toContain("booking_options_get");
  });

  it("reads the account endpoint", async () => {
    const fetchFn = routeFetch((url) => {
      expect(url.pathname.endsWith("/account.json")).toBe(true);
      return jsonResponse({
        plan_name: "Free Plan",
        searches_per_month: 250,
        plan_searches_left: 200,
        total_searches_left: 200,
        this_month_usage: 50,
        plan_renewal_date: "2026-09-01",
      });
    });
    const tool = flights.tools(pluginCtx({ SERPAPI_API_KEY: "test", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn))
      .find((item) => item.name === "account_get");
    const result = await tool?.call({}, call);
    expect(result?.isError).toBeUndefined();
    expect(JSON.parse(textOf(result ?? { content: [] }))).toMatchObject({
      searches_used: 50,
      searches_left: 200,
      plan_renewal_date: "2026-09-01",
    });
  });

  it("does not put the api key in a tool error", async () => {
    const fetchFn: typeof fetch = () => Promise.reject(new Error("boom api_key=super-secret"));
    const tool = flights.tools(pluginCtx({ SERPAPI_API_KEY: "super-secret", SERPAPI_BASE_URL: "https://serp.test" }, fetchFn))
      .find((item) => item.name === "offers_search");
    const result = await tool?.call({ origin: "SEA", destination: "SFO", outbound_date: "2026-09-01" }, call);
    expect(result?.isError).toBe(true);
    expect(textOf(result ?? { content: [] })).not.toContain("super-secret");
  });
});

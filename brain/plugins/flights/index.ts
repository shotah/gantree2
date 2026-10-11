import { errorResult, textResult, type CallContext, type Plugin, type PluginContext, type Tool, type ToolResult } from "@/brain/core/tools";
import { getBookingOptions } from "./booking";
import { account, clientFrom, type SerpClient } from "./client";
import {
  ACCOUNT_GET_DESCRIPTION,
  AIRPORTS_SEARCH_DESCRIPTION,
  airportsSearchSchema,
  BOOKING_OPTIONS_DESCRIPTION,
  bookingOptionsSchema,
  DATES_SEARCH_DESCRIPTION,
  datesSearchSchema,
  emptyInputSchema,
  LINK_FORMAT_DESCRIPTION,
  linkFormatSchema,
  OFFERS_SEARCH_DESCRIPTION,
  offersSearchSchema,
  RETURNS_SEARCH_DESCRIPTION,
  returnsSearchSchema,
} from "./schema";
import { searchAirports, searchDates, searchOffersWithUsage, selectDeparture } from "./search";
import {
  airportsResultJSON,
  bookingResultJSON,
  datesResultJSON,
  offerResultJSON,
  usageJSON,
  type DatesSearchRequest,
  type OfferSearchRequest,
} from "./types";
import { buildGoogleFlightsURL } from "./url";
import { goJSON } from "./wire";

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function argInt(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return 0;
}

function argBool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

const maxAirports = 8;
const maxIds = 8;
const maxLinks = 8;
const maxQueries = 8;

function trimmedStrings(value: unknown): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? [] : [text];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const text = item.trim();
    if (text !== "") {
      out.push(text);
    }
  }
  return out;
}

function collect(args: Record<string, unknown>, one: string, many: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...trimmedStrings(args[one]), ...trimmedStrings(args[many])]) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function overCap(label: string, values: readonly string[], max: number): string | null {
  if (values.length > max) {
    return `${label} accepts at most ${String(max)}`;
  }
  return null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "flights request failed";
}

function atList(list: readonly string[], index: number): string {
  if (list.length === 1) {
    return list[0] ?? "";
  }
  return list[index] ?? "";
}

function client(ctx: PluginContext, call: CallContext): SerpClient {
  return clientFrom(ctx.env, ctx.fetch, call.signal);
}

async function callTool(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return textResult(goJSON(await run()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "flights request failed";
    return errorResult(message);
  }
}

function offerRequest(args: Record<string, unknown>): OfferSearchRequest {
  return {
    origin: argString(args, "origin"),
    destination: argString(args, "destination"),
    outboundDate: argString(args, "outbound_date"),
    returnDate: argString(args, "return_date"),
    adults: argInt(args, "adults"),
    travelClass: argString(args, "travel_class"),
    stops: argString(args, "stops"),
    sortBy: argString(args, "sort_by"),
    currency: argString(args, "currency"),
    country: argString(args, "country"),
    language: argString(args, "language"),
    maxPrice: argInt(args, "max_price"),
    maxResults: argInt(args, "max_results"),
    deepSearch: argBool(args, "deep_search"),
    includeAirlines: argString(args, "include_airlines"),
    excludeAirlines: argString(args, "exclude_airlines"),
    excludeBasic: argBool(args, "exclude_basic"),
    flyAmerica: argString(args, "fly_america"),
    funding: argString(args, "funding"),
  };
}

function datesRequest(args: Record<string, unknown>): DatesSearchRequest {
  return {
    origin: argString(args, "origin"),
    destination: argString(args, "destination"),
    startDate: argString(args, "start_date"),
    endDate: argString(args, "end_date"),
    stayNights: argInt(args, "stay_nights"),
    stayNightsMin: argInt(args, "stay_nights_min"),
    stayNightsMax: argInt(args, "stay_nights_max"),
    currency: argString(args, "currency"),
    stops: argString(args, "stops"),
    travelClass: argString(args, "travel_class"),
    maxSamples: argInt(args, "max_samples"),
    includeAirlines: argString(args, "include_airlines"),
    excludeAirlines: argString(args, "exclude_airlines"),
  };
}

export const flights: Plugin = {
  name: "flights",
  ready(ctx) {
    const key = ctx.env.SERPAPI_API_KEY?.trim() ?? "";
    if (key === "") {
      return Promise.resolve("no_key");
    }
    return Promise.resolve(null);
  },
  tools(ctx) {
    const offers: Tool = {
      name: "offers_search",
      description: OFFERS_SEARCH_DESCRIPTION,
      inputSchema: offersSearchSchema,
      call(args, call) {
        const origins = collect(args, "origin", "origins");
        const destinations = collect(args, "destination", "destinations");
        const capped = overCap("origins", origins, maxAirports) ?? overCap("destinations", destinations, maxAirports);
        if (capped !== null) {
          return Promise.resolve(errorResult(capped));
        }
        const req = offerRequest(args);
        if (origins.length > 0) {
          req.origin = origins.join(",");
        }
        if (destinations.length > 0) {
          req.destination = destinations.join(",");
        }
        return callTool(async () => offerResultJSON(await searchOffersWithUsage(client(ctx, call), req)));
      },
    };
    const dates: Tool = {
      name: "dates_search",
      description: DATES_SEARCH_DESCRIPTION,
      inputSchema: datesSearchSchema,
      call(args, call) {
        const origins = collect(args, "origin", "origins");
        const destinations = collect(args, "destination", "destinations");
        const capped = overCap("origins", origins, maxAirports) ?? overCap("destinations", destinations, maxAirports);
        if (capped !== null) {
          return Promise.resolve(errorResult(capped));
        }
        const req = datesRequest(args);
        if (origins.length > 0) {
          req.origin = origins.join(",");
        }
        if (destinations.length > 0) {
          req.destination = destinations.join(",");
        }
        return callTool(async () => datesResultJSON(await searchDates(client(ctx, call), req)));
      },
    };
    const airports: Tool = {
      name: "airports_search",
      description: AIRPORTS_SEARCH_DESCRIPTION,
      inputSchema: airportsSearchSchema,
      call(args, call) {
        const queries = collect(args, "query", "queries");
        const capped = overCap("queries", queries, maxQueries);
        if (capped !== null) {
          return Promise.resolve(errorResult(capped));
        }
        const country = argString(args, "country");
        const language = argString(args, "language");
        return callTool(async () => {
          if (queries.length === 0) {
            return airportsResultJSON(await searchAirports(client(ctx, call), "", country, language));
          }
          const rows: Record<string, unknown>[] = [];
          for (const query of queries) {
            try {
              rows.push(airportsResultJSON(await searchAirports(client(ctx, call), query, country, language)));
            } catch (err) {
              rows.push({ query, error: errText(err) });
            }
          }
          return rows;
        });
      },
    };
    const returns: Tool = {
      name: "returns_search",
      description: RETURNS_SEARCH_DESCRIPTION,
      inputSchema: returnsSearchSchema,
      single: "SerpAPI takes one departure_token; the response is already the list of return options",
      call(args, call) {
        return callTool(async () => offerResultJSON(await selectDeparture(
          client(ctx, call),
          argString(args, "departure_token"),
          argString(args, "currency"),
          argString(args, "country"),
          argString(args, "language"),
        )));
      },
    };
    const booking: Tool = {
      name: "booking_options_get",
      description: BOOKING_OPTIONS_DESCRIPTION,
      inputSchema: bookingOptionsSchema,
      call(args, call) {
        const ids = collect(args, "booking_token", "ids");
        const capped = overCap("ids", ids, maxIds);
        if (capped !== null) {
          return Promise.resolve(errorResult(capped));
        }
        const currency = argString(args, "currency");
        const country = argString(args, "country");
        const language = argString(args, "language");
        const refundableOnly = argBool(args, "refundable_only");
        return callTool(async () => {
          if (ids.length === 0) {
            return bookingResultJSON(await getBookingOptions(client(ctx, call), {
              bookingToken: "",
              currency,
              country,
              language,
              refundableOnly,
            }));
          }
          const rows: Record<string, unknown>[] = [];
          for (const id of ids) {
            try {
              rows.push({
                booking_token: id,
                ...bookingResultJSON(await getBookingOptions(client(ctx, call), {
                  bookingToken: id,
                  currency,
                  country,
                  language,
                  refundableOnly,
                })),
              });
            } catch (err) {
              rows.push({ booking_token: id, error: errText(err) });
            }
          }
          return rows;
        });
      },
    };
    const link: Tool = {
      name: "link_format",
      description: LINK_FORMAT_DESCRIPTION,
      inputSchema: linkFormatSchema,
      call(args) {
        const origins = collect(args, "origin", "origins");
        const destinations = collect(args, "destination", "destinations");
        const outboundDates = collect(args, "outbound_date", "outbound_dates");
        const returnDates = collect(args, "return_date", "return_dates");
        const count = Math.max(origins.length, destinations.length, outboundDates.length, returnDates.length);
        if (count === 0) {
          return Promise.resolve(errorResult("origin, destination, and outbound_date are required"));
        }
        const capped = overCap("origins", origins, maxLinks)
          ?? overCap("destinations", destinations, maxLinks)
          ?? overCap("outbound_dates", outboundDates, maxLinks);
        if (capped !== null) {
          return Promise.resolve(errorResult(capped));
        }
        const note = "Fallback search URL only. Prefer booking_options_get for real checkout. This MCP never purchases tickets.";
        const rows: Record<string, unknown>[] = [];
        for (let i = 0; i < count; i += 1) {
          const origin = atList(origins, i);
          const destination = atList(destinations, i);
          const outbound = atList(outboundDates, i);
          if (origin === "" || destination === "" || outbound === "") {
            rows.push({
              origin,
              destination,
              outbound_date: outbound,
              error: "origin, destination, and outbound_date are required",
            });
            continue;
          }
          rows.push({
            google_flights_url: buildGoogleFlightsURL({
              origin,
              destination,
              outboundDate: outbound,
              returnDate: atList(returnDates, i),
              currency: argString(args, "currency"),
              country: argString(args, "country"),
              language: argString(args, "language"),
            }),
            note,
          });
        }
        return Promise.resolve(textResult(goJSON(rows)));
      },
    };
    const accountTool: Tool = {
      name: "account_get",
      description: ACCOUNT_GET_DESCRIPTION,
      inputSchema: emptyInputSchema,
      single: "one SerpAPI account and its monthly search quota",
      call(_args, call) {
        return callTool(async () => usageJSON(await account(client(ctx, call))));
      },
    };
    return [offers, dates, airports, returns, booking, link, accountTool];
  },
};

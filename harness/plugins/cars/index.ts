import { errorResult, textResult, type CallContext, type Plugin, type PluginContext, type Tool, type ToolResult } from "@/harness/core/tools";
import {
  clientFromEnv,
  dealersSearchJSON,
  listingGetJSON,
  listingsSearchJSON,
  listingsStatsJSON,
  marketStatsJSON,
  pricePredictJSON,
  type CarsClient,
  type DealersSearchRequest,
  type ListingsSearchRequest,
  type ListingsStatsRequest,
  type MarketStatsRequest,
  type PricePredictRequest,
  vinGetJSON,
} from "@/harness/plugins/cars/client";
import {
  ACCOUNT_GET_DESCRIPTION,
  DEALERS_SEARCH_DESCRIPTION,
  emptyInputSchema,
  LINK_FORMAT_DESCRIPTION,
  linkFormatSchema,
  LISTINGS_GET_DESCRIPTION,
  LISTINGS_SEARCH_DESCRIPTION,
  LISTINGS_STATS_DESCRIPTION,
  listingsGetSchema,
  listingsSearchSchema,
  listingsStatsSchema,
  MARKETS_GET_DESCRIPTION,
  marketsGetSchema,
  PRICE_PREDICT_DESCRIPTION,
  pricePredictSchema,
  VIN_GET_DESCRIPTION,
  vinGetSchema,
  dealersSearchSchema,
} from "@/harness/plugins/cars/schema";
import { usageJSON } from "@/harness/plugins/cars/usage";
import { goJSON, sortedRecord } from "@/harness/plugins/cars/wire";

export { keys } from "./keys";

const maxBatch = 8;

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

function argNum(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function argBool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function collectIds(args: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [
    ...trimmedStrings(args["listing_id"]),
    ...trimmedStrings(args["id"]),
    ...trimmedStrings(args["ids"]),
  ]) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

function objectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const item of value) {
    if (isRecord(item)) {
      out.push(item);
    }
  }
  return out;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "marketcheck request failed";
}

function apiKey(ctx: PluginContext): string {
  return (ctx.env.MARKETCHECK_API_KEY ?? "").trim();
}

function openClient(ctx: PluginContext, call: CallContext): CarsClient | null {
  if (apiKey(ctx) === "") {
    return null;
  }
  return clientFromEnv(ctx.env, ctx.sql, ctx.clock, ctx.fetch, call.signal);
}

async function callTool(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return textResult(goJSON(await run()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "marketcheck request failed";
    return errorResult(message);
  }
}

function searchRequest(args: Record<string, unknown>): ListingsSearchRequest {
  return {
    zip: argString(args, "zip"),
    city: argString(args, "city"),
    state: argString(args, "state"),
    radius: argNum(args, "radius"),
    make: argString(args, "make"),
    model: argString(args, "model"),
    trim: argString(args, "trim"),
    year: argInt(args, "year"),
    yearMin: argInt(args, "year_min"),
    yearMax: argInt(args, "year_max"),
    priceMin: argInt(args, "price_min"),
    priceMax: argInt(args, "price_max"),
    milesMin: argInt(args, "miles_min"),
    milesMax: argInt(args, "miles_max"),
    bodyType: argString(args, "body_type"),
    carType: argString(args, "car_type"),
    sellerType: argString(args, "seller_type"),
    rows: argInt(args, "rows"),
    start: argInt(args, "start"),
  };
}

function statsRequest(args: Record<string, unknown>): ListingsStatsRequest {
  return {
    zip: argString(args, "zip"),
    city: argString(args, "city"),
    state: argString(args, "state"),
    radius: argNum(args, "radius"),
    make: argString(args, "make"),
    model: argString(args, "model"),
    trim: argString(args, "trim"),
    year: argInt(args, "year"),
    yearMin: argInt(args, "year_min"),
    yearMax: argInt(args, "year_max"),
    priceMin: argInt(args, "price_min"),
    priceMax: argInt(args, "price_max"),
    milesMin: argInt(args, "miles_min"),
    milesMax: argInt(args, "miles_max"),
    bodyType: argString(args, "body_type"),
    carType: argString(args, "car_type"),
  };
}

function dealersRequest(args: Record<string, unknown>): DealersSearchRequest {
  return {
    zip: argString(args, "zip"),
    city: argString(args, "city"),
    state: argString(args, "state"),
    radius: argNum(args, "radius"),
    dealerType: argString(args, "dealer_type"),
    rows: argInt(args, "rows"),
    start: argInt(args, "start"),
  };
}

function priceRequest(args: Record<string, unknown>): PricePredictRequest {
  return {
    vin: argString(args, "vin"),
    miles: argInt(args, "miles"),
    zip: argString(args, "zip"),
    city: argString(args, "city"),
    state: argString(args, "state"),
    dealerType: argString(args, "dealer_type"),
    certified: argBool(args, "certified"),
  };
}

function marketRequest(args: Record<string, unknown>): MarketStatsRequest {
  return {
    year: argInt(args, "year"),
    make: argString(args, "make"),
    model: argString(args, "model"),
    trim: argString(args, "trim"),
    zip: argString(args, "zip"),
    state: argString(args, "state"),
  };
}

function linkFormat(args: Record<string, unknown>): Record<string, unknown> {
  const params = new URLSearchParams();
  const make = argString(args, "make").trim();
  if (make !== "") {
    params.append("makes[]", make.toLowerCase());
  }
  const model = argString(args, "model").trim();
  if (model !== "") {
    params.append("models[]", model.toLowerCase());
  }
  const zip = argString(args, "zip");
  if (zip !== "") {
    params.set("zip", zip);
  }
  const priceMax = argInt(args, "price_max");
  if (priceMax > 0) {
    params.set("list_price_max", String(priceMax));
  }
  const yearMin = argInt(args, "year_min");
  if (yearMin > 0) {
    params.set("year_min", String(yearMin));
  }
  const yearMax = argInt(args, "year_max");
  if (yearMax > 0) {
    params.set("year_max", String(yearMax));
  }
  const city = argString(args, "city");
  const state = argString(args, "state");
  const loc = [city, state, zip].map((part) => part.trim()).filter((part) => part !== "").join(" ");
  if (params.toString() === "" && loc === "") {
    throw new Error("provide zip or make/model (and optional city/state)");
  }
  const searchURL = `https://www.cars.com/shopping/results/?${params.toString()}`;
  return sortedRecord({
    search_url: searchURL,
    location: loc,
    note: "Fallback public search URL only. Prefer listings_search when API quota allows.",
  });
}

function accountBody(client: CarsClient | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: "MarketCheck",
    dashboard_url: "https://developers.marketcheck.com/",
    env_key: "MARKETCHECK_API_KEY",
    free_tier_note: "Free plan includes about 500 API calls per month and a 100-mile radius restriction.",
    quota_api: false,
    note: "MarketCheck has no public account API. usage below is a local counter of successful calls "
      + "from this binary (calendar month). Verify against the dashboard. link_format / account_get do not burn requests.",
    boot_note: "Missing API key does not prevent MCP initialize; search tools error until set.",
  };
  const usage = client?.accountUsage() ?? null;
  if (usage !== null) {
    out["usage"] = usageJSON(usage);
  }
  return sortedRecord(out);
}

export const cars: Plugin = {
  name: "cars",
  ready(ctx) {
    return Promise.resolve(apiKey(ctx) === "" ? "no_key" : null);
  },
  tools(ctx) {
    const listingsSearch: Tool = {
      name: "listings_search",
      description: LISTINGS_SEARCH_DESCRIPTION,
      inputSchema: listingsSearchSchema,
      call: (args, call) => callTool(async () => {
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const batch = objectList(args["searches"]);
        const requests = batch.length > 0 ? batch.map((item) => searchRequest(item)) : [searchRequest(args)];
        if (requests.length > maxBatch) {
          throw new Error("searches accepts at most 8");
        }
        const rows: Record<string, unknown>[] = [];
        for (const req of requests) {
          try {
            rows.push(listingsSearchJSON(await client.searchListings(req)));
          } catch (err) {
            rows.push({ error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const listingsGet: Tool = {
      name: "listings_get",
      description: LISTINGS_GET_DESCRIPTION,
      inputSchema: listingsGetSchema,
      call: (args, call) => callTool(async () => {
        const ids = collectIds(args);
        if (ids.length === 0) {
          throw new Error("listing_id is required");
        }
        if (ids.length > maxBatch) {
          throw new Error("ids accepts at most 8");
        }
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const sellerType = argString(args, "seller_type");
        const rows: Record<string, unknown>[] = [];
        for (const id of ids) {
          try {
            const listing = await client.getListing({ id, sellerType });
            rows.push(listingGetJSON(listing, client.accountUsage()));
          } catch (err) {
            rows.push({ listing_id: id, error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const listingsStats: Tool = {
      name: "listings_stats",
      description: LISTINGS_STATS_DESCRIPTION,
      inputSchema: listingsStatsSchema,
      call: (args, call) => callTool(async () => {
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const batch = objectList(args["queries"]);
        const requests = batch.length > 0 ? batch.map((item) => statsRequest(item)) : [statsRequest(args)];
        if (requests.length > maxBatch) {
          throw new Error("queries accepts at most 8");
        }
        const rows: Record<string, unknown>[] = [];
        for (const req of requests) {
          try {
            rows.push(listingsStatsJSON(await client.listingsStats(req)));
          } catch (err) {
            rows.push({ error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const vinGet: Tool = {
      name: "vin_get",
      description: VIN_GET_DESCRIPTION,
      inputSchema: vinGetSchema,
      call: (args, call) => callTool(async () => {
        const vins = [...trimmedStrings(args["vin"]), ...trimmedStrings(args["vins"])];
        const unique: string[] = [];
        const seen = new Set<string>();
        for (const vin of vins) {
          const key = vin.toUpperCase();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          unique.push(vin);
        }
        if (unique.length === 0) {
          throw new Error("vin is required");
        }
        if (unique.length > maxBatch) {
          throw new Error("vins accepts at most 8");
        }
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const rows: Record<string, unknown>[] = [];
        for (const vin of unique) {
          try {
            rows.push(vinGetJSON(await client.vinLookup(vin)));
          } catch (err) {
            rows.push({ vin, error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const dealersSearch: Tool = {
      name: "dealers_search",
      description: DEALERS_SEARCH_DESCRIPTION,
      inputSchema: dealersSearchSchema,
      call: (args, call) => callTool(async () => {
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const batch = objectList(args["searches"]);
        const requests = batch.length > 0 ? batch.map((item) => dealersRequest(item)) : [dealersRequest(args)];
        if (requests.length > maxBatch) {
          throw new Error("searches accepts at most 8");
        }
        const rows: Record<string, unknown>[] = [];
        for (const req of requests) {
          try {
            rows.push(dealersSearchJSON(await client.searchDealers(req)));
          } catch (err) {
            rows.push({ error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const pricePredict: Tool = {
      name: "price_predict",
      description: PRICE_PREDICT_DESCRIPTION,
      inputSchema: pricePredictSchema,
      call: (args, call) => callTool(async () => {
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const batch = objectList(args["predictions"]);
        const requests = batch.length > 0 ? batch.map((item) => priceRequest(item)) : [priceRequest(args)];
        if (requests.length > maxBatch) {
          throw new Error("predictions accepts at most 8");
        }
        const rows: Record<string, unknown>[] = [];
        for (const req of requests) {
          try {
            rows.push(pricePredictJSON(await client.predictPrice(req)));
          } catch (err) {
            rows.push({ vin: req.vin, error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const marketsGet: Tool = {
      name: "markets_get",
      description: MARKETS_GET_DESCRIPTION,
      inputSchema: marketsGetSchema,
      call: (args, call) => callTool(async () => {
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const batch = objectList(args["markets"]);
        const requests = batch.length > 0 ? batch.map((item) => marketRequest(item)) : [marketRequest(args)];
        if (requests.length > maxBatch) {
          throw new Error("markets accepts at most 8");
        }
        const rows: Record<string, unknown>[] = [];
        for (const req of requests) {
          try {
            rows.push(marketStatsJSON(await client.marketStats(req)));
          } catch (err) {
            rows.push({ make: req.make, model: req.model, error: errText(err) });
          }
        }
        return rows;
      }),
    };

    const link: Tool = {
      name: "link_format",
      description: LINK_FORMAT_DESCRIPTION,
      inputSchema: linkFormatSchema,
      call: (args) => callTool(() => {
        const links = objectList(args["links"]);
        if (links.length > 0) {
          if (links.length > maxBatch) {
            throw new Error("links accepts at most 8");
          }
          const rows: Record<string, unknown>[] = [];
          for (const item of links) {
            try {
              rows.push(linkFormat(item));
            } catch (err) {
              rows.push({ error: errText(err) });
            }
          }
          return Promise.resolve(rows);
        }
        return Promise.resolve([linkFormat(args)]);
      }),
    };

    const account: Tool = {
      name: "account_get",
      description: ACCOUNT_GET_DESCRIPTION,
      inputSchema: emptyInputSchema,
      single: "one MarketCheck usage counter for this agent",
      call: (_args, call) => callTool(() => Promise.resolve(accountBody(openClient(ctx, call)))),
    };

    return [
      listingsSearch,
      listingsGet,
      listingsStats,
      vinGet,
      dealersSearch,
      pricePredict,
      marketsGet,
      link,
      account,
    ];
  },
};

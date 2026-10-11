import { errorResult, textResult, type CallContext, type Plugin, type PluginContext, type Tool, type ToolResult } from "@/brain/core/tools";
import { areaJSON, resolveAreas, type AreaResolveResult } from "@/brain/plugins/rentals/areas";
import {
  clientFromEnv,
  listingGetJSON,
  listingsSearchJSON,
  marketStatsJSON,
  normalizeIntent,
  rentEstimateJSON,
  type ListingsSearchRequest,
  type RentalsClient,
} from "@/brain/plugins/rentals/client";
import {
  ACCOUNT_GET_DESCRIPTION,
  AREAS_RESOLVE_DESCRIPTION,
  areasResolveSchema,
  emptyInputSchema,
  LINK_FORMAT_DESCRIPTION,
  linkFormatSchema,
  LISTINGS_GET_DESCRIPTION,
  LISTINGS_SEARCH_DESCRIPTION,
  listingsGetSchema,
  listingsSearchSchema,
  MARKETS_GET_DESCRIPTION,
  marketsGetSchema,
  RENT_ESTIMATE_DESCRIPTION,
  rentEstimateSchema,
} from "@/brain/plugins/rentals/schema";
import { usageJSON } from "@/brain/plugins/rentals/usage";
import { goJSON, queryEscape, sortedRecord } from "@/brain/plugins/rentals/wire";

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

const maxBatch = 8;

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

function errText(err: unknown): string {
  return err instanceof Error ? err.message : "rentals request failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areaRow(name: string, result: AreaResolveResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    areas: result.areas.map(areaJSON),
    count: result.count,
  };
  if (name !== "") {
    out["name"] = name;
  }
  if (result.note !== undefined && result.note !== "") {
    out["note"] = result.note;
  }
  return out;
}

function apiKey(ctx: PluginContext): string {
  return (ctx.env.RENTCAST_API_KEY ?? "").trim();
}

function openClient(ctx: PluginContext, call: CallContext): RentalsClient | null {
  if (apiKey(ctx) === "") {
    return null;
  }
  return clientFromEnv(ctx.env, ctx.sql, ctx.clock, ctx.fetch, call.signal);
}

async function callTool(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return textResult(goJSON(await run()));
  } catch (err) {
    const message = err instanceof Error ? err.message : "rentals request failed";
    return errorResult(message);
  }
}

function searchRequest(args: Record<string, unknown>): ListingsSearchRequest {
  return {
    intent: argString(args, "intent"),
    city: argString(args, "city"),
    state: argString(args, "state"),
    zipCode: argString(args, "zip_code"),
    zipCodes: argString(args, "zip_codes"),
    neighborhood: argString(args, "neighborhood"),
    address: argString(args, "address"),
    latitude: argNum(args, "latitude"),
    longitude: argNum(args, "longitude"),
    radius: argNum(args, "radius"),
    propertyType: argString(args, "property_type"),
    bedrooms: argString(args, "bedrooms"),
    bathrooms: argString(args, "bathrooms"),
    squareFootage: argString(args, "square_footage"),
    priceMin: argInt(args, "price_min"),
    priceMax: argInt(args, "price_max"),
    status: argString(args, "status"),
    daysOld: argString(args, "days_old"),
    daysOldMax: argInt(args, "days_old_max"),
    newThisWeek: argBool(args, "new_this_week"),
    petsWanted: argBool(args, "pets_wanted"),
    parkingWanted: argBool(args, "parking_wanted"),
    laundryWanted: argBool(args, "laundry_wanted"),
    limit: argInt(args, "limit"),
    offset: argInt(args, "offset"),
  };
}

function linkFormat(args: Record<string, unknown>): Record<string, unknown> {
  const parts: string[] = [];
  const neighborhood = argString(args, "neighborhood").trim();
  const city = argString(args, "city").trim();
  const state = argString(args, "state").trim();
  const zip = argString(args, "zip_code").trim();
  if (neighborhood !== "") {
    parts.push(neighborhood);
  }
  if (city !== "") {
    parts.push(city);
  }
  if (state !== "") {
    parts.push(state);
  }
  if (zip !== "") {
    parts.push(zip);
  }
  const loc = parts.join(" ");
  if (loc === "") {
    throw new Error("provide city+state and/or zip_code (neighborhood optional)");
  }
  const intent = normalizeIntent(argString(args, "intent"));
  const path = intent === "buy" ? "for_sale" : "for_rent";
  const stateParam = queryEscape(`{"usersSearchTerm":${JSON.stringify(loc)}}`);
  let url = `https://www.zillow.com/homes/${path}/?searchQueryState=${stateParam}`;
  const bedrooms = argString(args, "bedrooms");
  if (bedrooms !== "") {
    url += `&beds=${queryEscape(bedrooms)}`;
  }
  const priceMax = argInt(args, "price_max");
  if (priceMax > 0) {
    url += `&price_max=${queryEscape(String(priceMax))}`;
  }
  const pets = argBool(args, "pets_wanted");
  if (pets) {
    url += "&pets=true";
  }
  let note = "Fallback public search URL only (not a RentCast listing). Defaults to for_rent. Prefer listings_search when API quota allows.";
  const parking = argBool(args, "parking_wanted");
  const laundry = argBool(args, "laundry_wanted");
  if (pets || parking || laundry) {
    note += " Amenity URL hints are best-effort; confirm on the site. RentCast cannot filter pets/parking/laundry.";
  }
  return sortedRecord({
    intent,
    search_url: url,
    location: loc,
    pets_wanted: pets,
    parking_wanted: parking,
    laundry_wanted: laundry,
    note,
  });
}

function accountBody(client: RentalsClient | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: "RentCast",
    dashboard_url: "https://app.rentcast.io/",
    free_tier_note: "Developer plan ≈ 50 API requests per calendar month (~1–2/day). Combine neighborhoods/zips into ONE listings_search.",
    quota_api: false,
    note: "Local counter resets on the 1st (see usage.period_resets). "
      + "Soft cap (default 40): billed tools require confirm_spend=true. "
      + "Hard cap (default 50): blocked — the model cannot unlock it; use link_format or wait for period_resets. "
      + "A human who upgraded RentCast can set RENTCAST_ALLOW_OVERAGE=1. "
      + "FREE: link_format, areas_resolve, account_get. Dashboard remains source of truth if billing cycle differs.",
  };
  const usage = client?.accountUsage() ?? null;
  if (usage !== null) {
    out["usage"] = usageJSON(usage);
  }
  return sortedRecord(out);
}

export const rentals: Plugin = {
  name: "rentals",
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
        return listingsSearchJSON(await client.searchListings(searchRequest(args), argBool(args, "confirm_spend")));
      }),
    };
    const listingsGet: Tool = {
      name: "listings_get",
      description: LISTINGS_GET_DESCRIPTION,
      inputSchema: listingsGetSchema,
      call: (args, call) => callTool(async () => {
        const ids = collect(args, "listing_id", "ids");
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
        const intent = argString(args, "intent");
        const confirm = argBool(args, "confirm_spend");
        const rows: Record<string, unknown>[] = [];
        for (const id of ids) {
          try {
            rows.push(listingGetJSON(await client.getListing(id, intent, confirm)));
          } catch (err) {
            rows.push({ listing_id: id, error: errText(err) });
          }
        }
        return rows;
      }),
    };
    const rentEstimate: Tool = {
      name: "rent_estimate_get",
      description: RENT_ESTIMATE_DESCRIPTION,
      inputSchema: rentEstimateSchema,
      call: (args, call) => callTool(async () => {
        const addresses = collect(args, "address", "addresses");
        if (addresses.length === 0) {
          throw new Error("address is required");
        }
        if (addresses.length > maxBatch) {
          throw new Error("addresses accepts at most 8");
        }
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const propertyType = argString(args, "property_type");
        const bedrooms = argString(args, "bedrooms");
        const bathrooms = argString(args, "bathrooms");
        const squareFootage = argString(args, "square_footage");
        const confirm = argBool(args, "confirm_spend");
        const rows: Record<string, unknown>[] = [];
        for (const address of addresses) {
          try {
            rows.push(rentEstimateJSON(await client.rentEstimate({
              address,
              propertyType,
              bedrooms,
              bathrooms,
              squareFootage,
            }, confirm)));
          } catch (err) {
            rows.push({ address, error: errText(err) });
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
        const zips = collect(args, "zip_code", "zips");
        if (zips.length === 0) {
          throw new Error("zip_code is required");
        }
        if (zips.length > maxBatch) {
          throw new Error("zips accepts at most 8");
        }
        const client = openClient(ctx, call);
        if (client === null) {
          throw new Error("client not configured");
        }
        const confirm = argBool(args, "confirm_spend");
        const rows: Record<string, unknown>[] = [];
        for (const zip of zips) {
          try {
            rows.push(marketStatsJSON(await client.marketStats(zip, confirm)));
          } catch (err) {
            rows.push({ zip_code: zip, error: errText(err) });
          }
        }
        return rows;
      }),
    };
    const areasResolve: Tool = {
      name: "areas_resolve",
      description: AREAS_RESOLVE_DESCRIPTION,
      inputSchema: areasResolveSchema,
      call: (args) => callTool(() => {
        const city = argString(args, "city");
        const state = argString(args, "state");
        const names = trimmedStrings(args["names"]);
        if (names.length > maxBatch) {
          throw new Error("names accepts at most 8");
        }
        if (names.length > 0) {
          const rows = names.map((name) => {
            try {
              return areaRow(name, resolveAreas({ neighborhood: name, city, state, listAll: false }));
            } catch (err) {
              return { name, error: errText(err) };
            }
          });
          return Promise.resolve(rows);
        }
        const result = resolveAreas({
          neighborhood: argString(args, "neighborhood"),
          city,
          state,
          listAll: argBool(args, "list_all"),
        });
        return Promise.resolve([areaRow(argString(args, "neighborhood").trim(), result)]);
      }),
    };
    const link: Tool = {
      name: "link_format",
      description: LINK_FORMAT_DESCRIPTION,
      inputSchema: linkFormatSchema,
      call: (args) => callTool(() => {
        const locations = args["locations"];
        if (Array.isArray(locations) && locations.length > 0) {
          if (locations.length > maxBatch) {
            throw new Error("locations accepts at most 8");
          }
          const rows: Record<string, unknown>[] = [];
          for (const item of locations) {
            if (!isRecord(item)) {
              rows.push({ error: "locations items must be objects" });
              continue;
            }
            try {
              const { locations: _locations, ...rest } = args;
              rows.push(linkFormat({ ...rest, ...item }));
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
      single: "one RentCast usage counter for this agent",
      call: (_args, call) => callTool(() => Promise.resolve(accountBody(openClient(ctx, call)))),
    };
    return [listingsSearch, listingsGet, rentEstimate, marketsGet, areasResolve, link, account];
  },
};

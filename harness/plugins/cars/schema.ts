import type { JsonSchema } from "@/harness/core/tools";

type ScalarProp = { type: "string" | "integer" | "number" | "boolean"; description: string };
type ArrayProp = { type: "array"; description: string; items: { type: "string" | "object" } };
type Prop = ScalarProp | ArrayProp;

function objectSchema(properties: Record<string, Prop>, required?: string[]): JsonSchema {
  const schema: JsonSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required !== undefined && required.length > 0) {
    schema.required = required;
  }
  return schema;
}

const str = (description: string): Prop => ({ type: "string", description });
const int = (description: string): Prop => ({ type: "integer", description });
const num = (description: string): Prop => ({ type: "number", description });
const bool = (description: string): Prop => ({ type: "boolean", description });
const strs = (description: string): Prop => ({ type: "array", description, items: { type: "string" } });
const objs = (description: string): Prop => ({ type: "array", description, items: { type: "object" } });

const locationFields: Record<string, Prop> = {
  zip: str("5-digit US zip (preferred location)"),
  city: str("City name"),
  state: str("2-letter state"),
  radius: num("Search radius in miles"),
};

const vehicleFilters: Record<string, Prop> = {
  make: str("Vehicle make (e.g. Toyota)"),
  model: str("Vehicle model (e.g. Camry)"),
  trim: str("Optional trim"),
  year: int("Exact model year"),
  year_min: int("Minimum model year"),
  year_max: int("Maximum model year"),
  price_min: int("Minimum asking price USD"),
  price_max: int("Maximum asking price USD"),
  miles_min: int("Minimum odometer miles"),
  miles_max: int("Maximum odometer miles"),
  body_type: str("SUV|sedan|truck|coupe|…"),
  car_type: str("used (default) | new | certified"),
};

export const emptyInputSchema: JsonSchema = { type: "object", additionalProperties: false };

export const LISTINGS_SEARCH_DESCRIPTION = "Search cars for sale (dealer inventory by default; optional FSBO/auction) "
  + "by zip or city/state + radius. Filter by make, model, year range, price, miles, body_type, "
  + "and car_type (used/new/certified). Returns ranked listing summaries with listing_url handoff. "
  + "Does not contact dealers or submit leads.";

export const LISTINGS_GET_DESCRIPTION = "Get one car listing by id from listings_search. "
  + "Use after the human picks a candidate. Does not contact dealers or submit leads.";

export const LISTINGS_STATS_DESCRIPTION = "Market snapshot for active inventory: price / miles / days-on-market aggregates "
  + "(min, max, mean, median) for a zip/city search + make/model filters. "
  + "Use for “what's hot / stale / priced like” context. Does not return listing rows — use listings_search for handoff.";

export const VIN_GET_DESCRIPTION = "NeoVIN decode: year, make, model, trim, options, engine, fuel economy when available. "
  + "Use when the human has a VIN. Does not contact dealers.";

export const DEALERS_SEARCH_DESCRIPTION = "Find car dealers near a zip or city/state (names, addresses, inventory size, type). "
  + "Present inventory_url for handoff. Does not contact dealers or submit leads.";

export const PRICE_PREDICT_DESCRIPTION = "Predict a fair retail market price for a VIN + mileage (+ zip). "
  + "Returns MarketCheck Price™ and MSRP. Compare with listings_search asking prices. Does not contact dealers.";

export const MARKETS_GET_DESCRIPTION = "Get Market Days Supply for a year/make/model (optional trim + zip/state). "
  + "Lower MDS ≈ faster turnover. Pair with listings_stats for price/DOM aggregates, or price_predict for VIN valuation.";

export const LINK_FORMAT_DESCRIPTION = "Build a public car SEARCH URL (Cars.com fallback) from zip/make/model/filters. "
  + "No API call and no lead form. Prefer listings_search when API quota allows.";

export const ACCOUNT_GET_DESCRIPTION = "Remind the agent about MarketCheck API usage / dashboard. "
  + "Does not call the network. Search tools need MARKETCHECK_API_KEY.";

export const listingsSearchSchema = objectSchema({
  ...locationFields,
  ...vehicleFilters,
  seller_type: str("dealer (default) | fsbo | auction"),
  rows: int("Page size (default 10, max 50)"),
  start: int("Pagination offset"),
  searches: objs("Up to 8 search objects (same fields as this tool). Flat fields still describe one search."),
});

export const listingsGetSchema = objectSchema({
  listing_id: str("MarketCheck listing id from listings_search"),
  id: str("MarketCheck listing id (alias for listing_id)"),
  ids: strs("MarketCheck listing ids (max 8). listing_id or id still works for one."),
  seller_type: str("dealer (default) | fsbo | auction — match the search that produced the id"),
}, ["listing_id"]);

export const listingsStatsSchema = objectSchema({
  ...locationFields,
  ...vehicleFilters,
  queries: objs("Up to 8 stats queries (same fields as this tool). Flat fields still describe one query."),
});

export const vinGetSchema = objectSchema({
  vin: str("17-character VIN"),
  vins: strs("17-character VINs (max 8). vin still works for one."),
}, ["vin"]);

export const dealersSearchSchema = objectSchema({
  ...locationFields,
  dealer_type: str("franchise | independent"),
  rows: int("Page size (default 10, max 50)"),
  start: int("Pagination offset"),
  searches: objs("Up to 8 dealer searches (same fields as this tool). Flat fields still describe one search."),
});

export const pricePredictSchema = objectSchema({
  vin: str("17-character VIN"),
  miles: int("Current odometer miles (required)"),
  zip: str("5-digit US zip for local pricing"),
  city: str("City (with state) for local pricing"),
  state: str("2-letter state"),
  dealer_type: str("franchise (default) | independent"),
  certified: bool("Treat as certified pre-owned (CPO)"),
  predictions: objs("Up to 8 price predictions (vin, miles, zip/city/state, …). Flat vin+miles still works for one."),
}, ["vin", "miles"]);

export const marketsGetSchema = objectSchema({
  year: int("Model year"),
  make: str("Vehicle make"),
  model: str("Vehicle model"),
  trim: str("Optional trim"),
  zip: str("Optional zip for local market"),
  state: str("Optional state"),
  markets: objs("Up to 8 year/make/model lookups (same fields as this tool). Flat make+model still works for one."),
}, ["make", "model"]);

export const linkFormatSchema = objectSchema({
  zip: str("Zip code"),
  city: str("City"),
  state: str("State"),
  make: str("Make"),
  model: str("Model"),
  year_min: int("Min year"),
  year_max: int("Max year"),
  price_max: int("Max price"),
  links: objs("Up to 8 link specs (same fields as this tool). Flat fields still describe one link."),
});

export const TOOL_NAMES = [
  "listings_search",
  "listings_get",
  "listings_stats",
  "vin_get",
  "dealers_search",
  "price_predict",
  "markets_get",
  "link_format",
  "account_get",
] as const;

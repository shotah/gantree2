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

const confirmSpend = bool("Required after the soft cap (usage.confirm_required). Re-call with confirm_spend=true to spend 1 remaining request. Cannot bypass the hard cap of 50.");

export const emptyInputSchema: JsonSchema = { type: "object", additionalProperties: false };

export const LISTINGS_SEARCH_DESCRIPTION = "Search US long-term FOR-RENT residential listings (default). Burns 1 RentCast request to GET /listings/rental/long-term. "
  + "Pass intent=buy only for homes for sale. HARD CAP 50/month — blocked with no model bypass. After the soft cap (~40) re-call with confirm_spend=true. "
  + "THRIFTY: pass multiple neighborhoods as comma-separated neighborhood=Ballard,Fremont OR zip_codes=98107,98103 "
  + "AND/OR property_type=house,condo for ONE call — never one search per area or type. "
  + "Filter tightly (bedrooms, price_max, new_this_week). Soft pets/parking/laundry prefs are not API filters. "
  + "Handoff is agent/office phone and email (who is marketing the rental). RentCast has no Zillow listing URL. "
  + "Does not apply, make offers, or contact landlords/agents.";

export const LISTINGS_GET_DESCRIPTION = "Get FOR-RENT listings by id (default catalog /listings/rental/long-term/{id}; each id burns 1 RentCast request). "
  + "Only after the human picks candidates from search. HARD CAP 50/month; after soft cap use confirm_spend=true. "
  + "Pass intent=buy only if the id came from a buy search. "
  + "ids accepts up to 8 listing ids. listing_id still works for one. A bad id is an error row. "
  + "Present agent/office phone and email. Does not apply, make offers, or contact landlords/agents.";

export const RENT_ESTIMATE_DESCRIPTION = "Fair-rent AVM (each address burns 1 RentCast request). Use sparingly when asking if a listed rent is reasonable. "
  + "HARD CAP 50/month; after soft cap use confirm_spend=true. Not for commercial spaces. "
  + "addresses accepts up to 8. address still works for one. Property hints apply to every address. A bad address is an error row.";

export const MARKETS_GET_DESCRIPTION = "Zip rental market aggregates (each zip burns 1 RentCast request). Optional context — skip if quota is tight; "
  + "prefer a tight listings_search instead. HARD CAP 50/month; after soft cap use confirm_spend=true. "
  + "zips accepts up to 8. zip_code still works for one. A bad zip is an error row.";

export const AREAS_RESOLVE_DESCRIPTION = "FREE (no RentCast call). Resolve Seattle neighborhood name(s) to zips/lat/lng. "
  + "names accepts up to 8. neighborhood still works for one. An unknown name is an error row. "
  + "Use list_all=true once, then ONE listings_search with neighborhood=A,B,C or zip_codes=… — not N searches.";

export const LINK_FORMAT_DESCRIPTION = "FREE public search URL fallback (no RentCast call). Defaults to Zillow for_rent. "
  + "Pass intent=buy only for for_sale. Prefer when usage.cap_state is confirm_required or exhausted. "
  + "locations accepts up to 8 place objects (same fields as this tool). Flat city/state/zip still works for one.";

export const ACCOUNT_GET_DESCRIPTION = "FREE local usage counter (requests_used / requests_left / cap_state / period_resets on the 1st). "
  + "Check before burning RentCast calls. Soft cap needs confirm_spend; hard cap (50) cannot be unlocked by the model. "
  + "Does not call the network.";

export const listingsSearchSchema = objectSchema({
  intent: str("Defaults to rent (long-term FOR-RENT catalog /listings/rental/long-term). Pass buy only for homes for sale (/listings/sale). Do not guess buy."),
  city: str("City name (case-sensitive upstream; e.g. Seattle)"),
  state: str("2-letter state (e.g. WA)"),
  zip_code: str("5-digit US zip code"),
  zip_codes: str("Comma/pipe-separated zips — ONE API call with city+state (client zip filter). Prefer this over multiple searches."),
  neighborhood: str("Seattle preset(s), comma-separated OK e.g. Ballard,Fremont,Wallingford — ONE API call. Do not search each area separately."),
  address: str("Full address Street, City, State, Zip"),
  latitude: num("Search center latitude"),
  longitude: num("Search center longitude"),
  radius: num("Radius in miles (max 100); use with lat/lng or address"),
  property_type: str("apartment|house|condo|townhouse|manufactured|multi_family|land (land is sale-only). Comma/pipe list OK e.g. house,condo — ONE API call, not one per type."),
  bedrooms: str("Bedrooms; 0=studio; ranges like 1:2 ok"),
  bathrooms: str("Bathrooms; ranges ok"),
  square_footage: str("Living area sqft; ranges ok"),
  price_min: int("Minimum USD — monthly rent if intent=rent; purchase price if intent=buy"),
  price_max: int("Maximum USD — monthly rent if intent=rent; purchase price if intent=buy"),
  days_old: str("Max listing age in days (RentCast daysOld); e.g. 7 or *:7"),
  days_old_max: int("Max days on market (shorthand for days_old)"),
  new_this_week: bool("Only listings ≤7 days old (sets days_old_max=7)"),
  pets_wanted: bool("Soft preference only — RentCast cannot filter pets; verify with agent/office"),
  parking_wanted: bool("Soft preference only — RentCast cannot filter parking; verify with agent/office"),
  laundry_wanted: bool("Soft preference only — RentCast cannot filter laundry; verify with agent/office"),
  status: str("Active (default) or Inactive"),
  limit: int("Page size (default 10, max 50)"),
  offset: int("Pagination offset"),
  confirm_spend: confirmSpend,
});

export const listingsGetSchema = objectSchema({
  listing_id: str("RentCast listing id from listings_search"),
  ids: strs("RentCast listing ids from listings_search (max 8). listing_id still works for one. Each id burns one request."),
  intent: str("Defaults to rent (same for-rent catalog as listings_search). Pass buy only if the id came from a buy search. Sale and rental ids are different catalogs."),
  confirm_spend: confirmSpend,
}, ["listing_id"]);

export const rentEstimateSchema = objectSchema({
  address: str("Full address Street, City, State, Zip"),
  addresses: strs("Full addresses (max 8). address still works for one. property_type, bedrooms, bathrooms, and square_footage apply to each."),
  property_type: str("Optional property type hint"),
  bedrooms: str("Optional bedrooms (0=studio)"),
  bathrooms: str("Optional bathrooms"),
  square_footage: str("Optional living area sqft"),
  confirm_spend: confirmSpend,
}, ["address"]);

export const marketsGetSchema = objectSchema({
  zip_code: str("5-digit US zip code"),
  zips: strs("5-digit US zip codes (max 8). zip_code still works for one. Each zip burns one request."),
  confirm_spend: confirmSpend,
}, ["zip_code"]);

export const areasResolveSchema = objectSchema({
  neighborhood: str("Neighborhood name or alias (e.g. Capitol Hill, u district)"),
  names: strs("Neighborhood names or aliases (max 8). neighborhood still works for one. list_all ignores names."),
  city: str("Optional city filter (e.g. Seattle)"),
  state: str("Optional 2-letter state filter"),
  list_all: bool("List all known presets (optionally filtered by city/state)"),
});

export const linkFormatSchema = objectSchema({
  intent: str("Defaults to rent (Zillow for_rent). Pass buy only for for_sale."),
  city: str("City name"),
  state: str("2-letter state"),
  zip_code: str("Zip code"),
  neighborhood: str("Optional neighborhood for search term"),
  bedrooms: str("Optional bedrooms"),
  price_max: int("Optional max USD (monthly rent if intent=rent; purchase price if intent=buy)"),
  property_type: str("apartment|house|…"),
  pets_wanted: bool("Hint for public search URL only"),
  parking_wanted: bool("Hint noted in response; not all sites support URL filters"),
  laundry_wanted: bool("Hint noted in response; not all sites support URL filters"),
  locations: objs("Up to 8 places. Each object uses the same fields as this tool (city, state, zip_code, neighborhood, intent, …). Flat fields still describe one place."),
});

export const TOOL_NAMES = [
  "listings_search",
  "listings_get",
  "rent_estimate_get",
  "markets_get",
  "areas_resolve",
  "link_format",
  "account_get",
] as const;

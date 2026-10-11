import type { JsonSchema } from "@/brain/core/tools";

type ScalarProp = { type: "string" | "integer" | "boolean"; description: string };
type ArrayProp = { type: "array"; description: string; items: { type: "string" } };
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
const bool = (description: string): Prop => ({ type: "boolean", description });
const strs = (description: string): Prop => ({ type: "array", description, items: { type: "string" } });

export const emptyInputSchema: JsonSchema = { type: "object", additionalProperties: false };

export const offersSearchSchema = objectSchema({
  origin: str("Departure airport IATA code or Google location id (e.g. SEA or /m/0d9jr)"),
  origins: strs("Alternate departure airports for one search (IATA or location ids, max 8). SerpAPI joins these with origin into one departure_id. Not separate trips."),
  destination: str("Arrival airport IATA code or Google location id (e.g. CDG)"),
  destinations: strs("Alternate arrival airports for one search (max 8). SerpAPI joins these with destination into one arrival_id."),
  outbound_date: str("Departure date YYYY-MM-DD. One date per call; a window of days is dates_search."),
  return_date: str("Return date YYYY-MM-DD for round-trip; omit for one-way"),
  adults: int("Number of adults (default 1)"),
  travel_class: str("economy (default), premium_economy, business, or first"),
  stops: str("any (default), nonstop, 1_or_fewer, or 2_or_fewer"),
  sort_by: str("top (default), price, or duration"),
  currency: str("Currency code (default USD)"),
  country: str("Google country code gl (default us)"),
  language: str("Language code hl (default en)"),
  max_price: int("Maximum ticket price filter"),
  max_results: int("Max offers to return (default 10)"),
  deep_search: bool("If true, slower SerpAPI deep search matching browser results"),
  include_airlines: str("Comma-separated IATA codes and/or SKYTEAM, ONEWORLD, STAR_ALLIANCE; presets alaska_partners or delta_partners. Cannot combine with exclude_airlines."),
  exclude_airlines: str("Comma-separated IATA codes and/or alliances to exclude. Cannot combine with include_airlines."),
  exclude_basic: bool("Exclude basic economy (free seat + carry-on). SerpAPI: US domestic + economy only. Not the same as refundable."),
  fly_america: str("annotate (label offers) or filter (drop likely_foreign). Heuristic on marketing designators only — not legal certification."),
  funding: str("civilian (default) or dod — affects Open Skies hint text only"),
}, ["origin", "destination", "outbound_date"]);

export const datesSearchSchema = objectSchema({
  origin: str("Departure airport IATA code"),
  origins: strs("Alternate departure airports for one window (max 8). Joined with origin into one SerpAPI search."),
  destination: str("Arrival airport IATA code"),
  destinations: strs("Alternate arrival airports for one window (max 8). Joined with destination into one SerpAPI search."),
  start_date: str("Outbound window start YYYY-MM-DD"),
  end_date: str("Outbound window end YYYY-MM-DD"),
  stay_nights: int("If >0, fixed round-trip stay (return = outbound + nights). Wins over min/max."),
  stay_nights_min: int("Min stay nights for a range scan (e.g. 4). Use with stay_nights_max."),
  stay_nights_max: int("Max stay nights for a range scan (e.g. 7). Samples spread across the range within max_samples."),
  currency: str("Currency code (default USD)"),
  stops: str("any (default), nonstop, 1_or_fewer, or 2_or_fewer"),
  travel_class: str("economy (default), premium_economy, business, or first"),
  max_samples: int("How many samples (default 5, max 7) — each sample is one SerpAPI search"),
  include_airlines: str("Same tokens as offers_search include_airlines"),
  exclude_airlines: str("Same tokens as offers_search exclude_airlines"),
}, ["origin", "destination", "start_date", "end_date"]);

export const airportsSearchSchema = objectSchema({
  query: str("Name prefix: city or airport fragment (e.g. Seattle, Charles de Gaulle). Matches the autocomplete prefix."),
  queries: strs("Name prefixes to resolve together (max 8). query still works for one."),
  country: str("Google country code gl (default us)"),
  language: str("Language code hl (default en)"),
}, ["query"]);

export const returnsSearchSchema = objectSchema({
  departure_token: str("departure_token from an offers_search outbound offer"),
  currency: str("Currency code (default USD)"),
  country: str("Google country code gl (default us)"),
  language: str("Language code hl (default en)"),
}, ["departure_token"]);

export const bookingOptionsSchema = objectSchema({
  booking_token: str("booking_token from offers_search (one-way) or returns_search (round-trip)"),
  ids: strs("booking_token values to price together (max 8). booking_token still works for one. A bad token is an error row."),
  currency: str("Currency code (default USD)"),
  country: str("Google country code gl (default us)"),
  language: str("Language code hl (default en)"),
  refundable_only: bool("If true, drop options Google labels as non-refundable; keeps yes and unknown"),
}, ["booking_token"]);

export const linkFormatSchema = objectSchema({
  origin: str("Departure IATA code"),
  origins: strs("Departure IATA codes, parallel with destinations and outbound_dates (max 8). One origin is repeated across the other lists."),
  destination: str("Arrival IATA code"),
  destinations: strs("Arrival IATA codes, parallel with origins and outbound_dates (max 8)."),
  outbound_date: str("Departure date YYYY-MM-DD"),
  outbound_dates: strs("Departure dates YYYY-MM-DD, parallel with origins and destinations (max 8)."),
  return_date: str("Return date YYYY-MM-DD for round-trip"),
  return_dates: strs("Return dates YYYY-MM-DD, parallel with outbound_dates. One return_date applies to every trip."),
  currency: str("Currency code (default USD)"),
  country: str("Google country code gl (default us)"),
  language: str("Language code hl (default en)"),
}, ["origin", "destination", "outbound_date"]);

export const OFFERS_SEARCH_DESCRIPTION = "Search Google Flights prices and itineraries for fixed dates (one-way or round-trip). "
  + "Returns ranked offers with summaries, price_insights (level, typical range, price_history), "
  + "departure_token / booking_token, and a fallback google_flights_url. "
  + "Supports include_airlines/exclude_airlines (IATA, SKYTEAM/ONEWORLD/STAR_ALLIANCE, or "
  + "alaska_partners/delta_partners), exclude_basic (US domestic economy only; not refundable), "
  + "and fly_america=annotate|filter (heuristic marketing-designator hint — not legal certification). "
  + "For real checkout: one-way → booking_options_get(booking_token); round-trip outbound → "
  + "returns_search(departure_token) then booking_options_get. Does not purchase tickets. "
  + "Prefer IATA codes; call airports_search if the city is ambiguous. Prefer dates_search when dates are flexible. "
  + "origins and destinations are alternate airports on one SerpAPI search (max 8), not one call per city pair. "
  + "outbound_date stays one day — SerpAPI does not take a date list here.";

export const DATES_SEARCH_DESCRIPTION = "Scan Google Flights prices across a departure date window to find cheaper days. "
  + "One-way by default; stay_nights for a fixed round-trip length; stay_nights_min/max (e.g. 4 and 7) "
  + "to spread samples across a stay-length range within the same ≤7 SerpAPI call budget. "
  + "Supports include_airlines/exclude_airlines (same tokens as offers_search). "
  + "Use before locking dates, then confirm with offers_search. Does not purchase tickets. "
  + "origins and destinations are alternate airports joined into that one window (max 8). "
  + "start_date and end_date are the date set.";

export const AIRPORTS_SEARCH_DESCRIPTION = "Resolve a city or airport name prefix to IATA codes / Google location ids for flight search. "
  + "Call this before offers_search when the human names a city (Seattle, Paris) instead of an airport code. "
  + "queries accepts up to 8 prefixes in one call. query still works for one.";

export const RETURNS_SEARCH_DESCRIPTION = "Select an outbound flight via departure_token from offers_search and load return-leg options "
  + "(with booking_token). Required for round-trip checkout. Then call booking_options_get. "
  + "Does not purchase tickets.";

export const BOOKING_OPTIONS_DESCRIPTION = "Get real airline/OTA checkout options for a booking_token from offers_search or returns_search. "
  + "Returns book_with, fare title, price, refundable (yes/no/unknown from Google text), "
  + "and booking.url (+ booking.post_data when Google requires POST). "
  + "Set refundable_only=true to drop options Google labels as non-refundable. "
  + "This is the real buy path — not google_flights_url. Does not purchase tickets itself. "
  + "ids accepts up to 8 booking tokens. One bad token comes back as an error row.";

export const LINK_FORMAT_DESCRIPTION = "Build a Google Flights SEARCH URL with route/dates prefilled via q= (fallback only). "
  + "Does NOT open a specific fare checkout — prefer booking_options_get for buy links. "
  + "No API call and no purchase. "
  + "origins, destinations, and outbound_dates are parallel lists (max 8) and return one URL per trip. "
  + "A single origin, destination, and outbound_date still works.";

export const ACCOUNT_GET_DESCRIPTION = "Check SerpAPI monthly search usage and plan renewal/reset date without running a flight search. "
  + "This account check is free and does not burn quota. Search tools also attach a usage snapshot on their responses.";

export const TOOL_NAMES = [
  "offers_search",
  "dates_search",
  "airports_search",
  "returns_search",
  "booking_options_get",
  "link_format",
  "account_get",
] as const;

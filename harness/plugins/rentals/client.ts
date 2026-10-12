import type { Clock } from "@/harness/core/clock";
import type { Sql } from "@/harness/core/sql";
import { expandListingsSearch, filterListingsByZips, type ListingsSearchRequest } from "@/harness/plugins/rentals/expand";
import { usageJSON, usageTracker, type Usage, type UsageTracker } from "@/harness/plugins/rentals/usage";
import { asRecord, intNum, isRecord, num, parseJSON, queryEscape, redact, round0, sortedRecord, str, truncate } from "@/harness/plugins/rentals/wire";

export type { ListingsSearchRequest };

export const defaultBaseURL = "https://api.rentcast.io/v1";
export const defaultLimit = 10;
export const maxAgentLimit = 50;
const maxRadiusMiles = 100;
const maxResponseBytes = 8 << 20;
const userAgent = "rentals-search-mcp/1.0";

export const intentRent = "rent";
export const intentBuy = "buy";

export type ListingContact = {
  name?: string;
  phone?: string;
  email?: string;
  website?: string;
};

export type Listing = {
  id: string;
  intent: string;
  formattedAddress: string;
  city: string;
  state: string;
  zipCode: string;
  propertyType: string;
  listingType: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  price: number;
  status: string;
  daysOnMarket: number;
  listedDate: string;
  mlsName: string;
  mlsNumber: string;
  searchURL: string;
  latitude: number;
  longitude: number;
  agent: ListingContact | null;
  office: ListingContact | null;
};

export type ListingsSearchResult = {
  intent: string;
  listings: Listing[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  summary: string;
  query: Record<string, unknown>;
  note: string;
  usage: Usage | null;
};

export type ListingGetResult = { listing: Listing; usage: Usage | null };

export type RentEstimateRequest = {
  address?: string;
  propertyType?: string;
  bedrooms?: string;
  bathrooms?: string;
  squareFootage?: string;
};

export type RentEstimateResult = {
  address: string;
  rentEstimate: number;
  rentRangeLow: number;
  rentRangeHigh: number;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  note: string;
  usage: Usage | null;
};

export type MarketTypeStat = {
  propertyType: string;
  averageRent: number;
  medianRent: number;
  totalListings: number;
};

export type MarketStatsResult = {
  zipCode: string;
  averageRent: number;
  medianRent: number;
  minRent: number;
  maxRent: number;
  totalListings: number;
  newListings: number;
  averageDaysOnMarket: number;
  medianDaysOnMarket: number;
  byPropertyType: MarketTypeStat[];
  note: string;
  usage: Usage | null;
};

export type RentalsClient = {
  apiKey: string;
  baseURL: string;
  usage: UsageTracker;
  searchListings(req: ListingsSearchRequest, confirm: boolean): Promise<ListingsSearchResult>;
  getListing(id: string, intent: string, confirm: boolean): Promise<ListingGetResult>;
  rentEstimate(req: RentEstimateRequest, confirm: boolean): Promise<RentEstimateResult>;
  marketStats(zipCode: string, confirm: boolean): Promise<MarketStatsResult>;
  accountUsage(): Usage | null;
};

export function clientFromEnv(
  env: Readonly<Record<string, string>>,
  sql: Sql,
  clock: Clock,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): RentalsClient {
  const key = (env.RENTCAST_API_KEY ?? "").trim();
  if (key === "") {
    throw new Error("RENTCAST_API_KEY is required");
  }
  const base = (env.RENTCAST_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return createClient({
    apiKey: key,
    baseURL: base === "" ? defaultBaseURL : base,
    fetch: fetchFn,
    signal,
    usage: usageTracker(env, sql, clock),
  });
}

export function createClient(opts: {
  apiKey: string;
  baseURL: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
  usage: UsageTracker;
}): RentalsClient {
  const client: RentalsClient = {
    apiKey: opts.apiKey,
    baseURL: opts.baseURL.replace(/\/+$/, "") || defaultBaseURL,
    usage: opts.usage,
    searchListings: (req, confirm) => searchListings(client, opts.fetch, opts.signal, req, confirm),
    getListing: (id, intent, confirm) => getListing(client, opts.fetch, opts.signal, id, intent, confirm),
    rentEstimate: (req, confirm) => rentEstimate(client, opts.fetch, opts.signal, req, confirm),
    marketStats: (zip, confirm) => marketStats(client, opts.fetch, opts.signal, zip, confirm),
    accountUsage: () => opts.usage.snapshot(),
  };
  return client;
}

export function normalizeIntent(raw: string): string {
  const value = raw.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  switch (value) {
    case "":
    case intentRent:
    case "rental":
    case "rentals":
    case "lease":
    case "leasing":
    case "for_rent":
    case "forrent":
      return intentRent;
    case intentBuy:
    case "sale":
    case "sales":
    case "purchase":
    case "purchasing":
    case "buying":
    case "for_sale":
    case "forsale":
      return intentBuy;
    default:
      throw new Error(`intent must be rent or buy (got ${JSON.stringify(raw)}). Default is rent (long-term for-rent). Pass buy only for homes for sale`);
  }
}

export function normalizePropertyType(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  if (/[|,;]/.test(trimmed)) {
    const parts = trimmed.replaceAll(",", "|").replaceAll(";", "|").split("|");
    const out: string[] = [];
    for (const part of parts) {
      const one = normalizeOnePropertyType(part);
      if (one !== "") {
        out.push(one);
      }
    }
    return out.join("|");
  }
  return normalizeOnePropertyType(trimmed);
}

function normalizeOnePropertyType(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  switch (trimmed.toLowerCase().replaceAll("-", "_")) {
    case "apartment":
    case "apartments":
      return "Apartment";
    case "house":
    case "home":
    case "homes":
    case "single_family":
    case "singlefamily":
    case "sfh":
      return "Single Family";
    case "condo":
    case "condos":
    case "condominium":
      return "Condo";
    case "townhouse":
    case "townhome":
    case "townhouses":
    case "townhomes":
      return "Townhouse";
    case "manufactured":
    case "mobile":
    case "mobile_home":
      return "Manufactured";
    case "multi_family":
    case "multifamily":
    case "duplex":
    case "triplex":
    case "fourplex":
      return "Multi-Family";
    case "land":
    case "lot":
    case "lots":
      return "Land";
    default:
      return trimmed;
  }
}

export function formatPriceRange(priceMin: number, priceMax: number): string {
  if (priceMin > 0 && priceMax > 0) {
    return `${String(priceMin)}:${String(priceMax)}`;
  }
  if (priceMin > 0) {
    return `${String(priceMin)}:*`;
  }
  if (priceMax > 0) {
    return `*:${String(priceMax)}`;
  }
  return "";
}

export function normalizePage(limit: number, offset: number): { limit: number; offset: number } {
  let nextLimit = limit;
  let nextOffset = offset;
  if (nextLimit <= 0) {
    nextLimit = defaultLimit;
  }
  if (nextLimit > maxAgentLimit) {
    nextLimit = maxAgentLimit;
  }
  if (nextOffset < 0) {
    nextOffset = 0;
  }
  return { limit: nextLimit, offset: nextOffset };
}

export function validateSearchRequest(req: ListingsSearchRequest): void {
  const intent = normalizeIntent(req.intent ?? "");
  if (intent === intentRent && propertyTypeIncludesLand(req.propertyType ?? "")) {
    throw new Error("property_type=land is sale-only; for-rent search uses /listings/rental/long-term and cannot include land");
  }
  const hasZip = (req.zipCode ?? "").trim() !== "" || (req.zipFilter ?? []).length > 0;
  const hasCityState = (req.city ?? "").trim() !== "" && (req.state ?? "").trim() !== "";
  const hasAddress = (req.address ?? "").trim() !== "";
  const hasLatLng = (req.latitude ?? 0) !== 0 || (req.longitude ?? 0) !== 0;
  if (!hasZip && !hasCityState && !hasAddress && !hasLatLng) {
    throw new Error("provide city+state, zip_code, neighborhood, address, or latitude/longitude");
  }
  if ((req.radius ?? 0) < 0) {
    throw new Error("radius must be >= 0");
  }
  if ((req.radius ?? 0) > maxRadiusMiles) {
    throw new Error(`radius max is ${String(maxRadiusMiles)} miles`);
  }
  if ((req.offset ?? 0) < 0) {
    throw new Error("offset must be >= 0");
  }
  if ((req.daysOldMax ?? 0) < 0) {
    throw new Error("days_old_max must be >= 0");
  }
}

export function googleListingSearchURL(addr: string, intent: string): string {
  const trimmed = addr.trim();
  if (trimmed === "") {
    return "";
  }
  const suffix = intent === intentBuy ? " for sale" : " rental";
  return `https://www.google.com/search?q=${queryEscape(trimmed + suffix)}`;
}

export function summarizeListings(listings: Listing[], total: number, _limit: number, offset: number, intent: string): string {
  if (listings.length === 0) {
    return "No listings matched. Widen beds/price, try a nearby zip, or drop property_type.";
  }
  const ranked = [...listings].sort((a, b) => {
    if (a.daysOnMarket !== b.daysOnMarket) {
      return a.daysOnMarket - b.daysOnMarket;
    }
    if (a.price !== b.price) {
      return a.price - b.price;
    }
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  });
  const n = Math.min(3, ranked.length);
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const listing = ranked[i];
    if (listing === undefined) {
      continue;
    }
    parts.push(`${shortAddress(listing)} — ${formatListingPrice(listing.price, intent)}, ${formatBeds(listing.bedrooms)}, ${orDefault(listing.propertyType, "home")} (${String(listing.daysOnMarket)} days on market)`);
  }
  let pageNote = `Showing ${String(listings.length)}`;
  if (total > listings.length) {
    pageNote = `Showing ${String(listings.length)} of ~${String(total)}`;
  }
  if (offset > 0) {
    pageNote += ` (offset ${String(offset)})`;
  }
  let fresh = 0;
  for (const listing of listings) {
    if (listing.daysOnMarket > 0 && listing.daysOnMarket <= 7) {
      fresh += 1;
    }
  }
  const freshNote = fresh > 0 ? ` ${String(fresh)} listing(s) look new this week (≤7 days on market).` : "";
  const handoff = intent === intentBuy
    ? " ALWAYS present agent/office phone and email. search_url is a Google fallback. Do not make offers for them."
    : " ALWAYS present agent/office phone and email. search_url is a Google fallback — RentCast has no portal listing URL. Do not apply for them.";
  return `${pageNote}. Top picks (freshest / value): ${parts.join("; ")}.${freshNote}${handoff}`;
}

function searchHandoffNote(intent: string): string {
  const action = intent === intentBuy
    ? "Do not make offers or contact listing agents on the human's behalf."
    : "Do not apply or message landlords/agents on the human's behalf.";
  return "RentCast has no Zillow/Apartments.com/Realtor listing URL. "
    + "ALWAYS present agent/office phone, email, and name — that is who is marketing this property. "
    + "agent.website / office.website are broker pages when present, not a unit listing. "
    + `search_url is a Google address fallback. ${action}`;
}

function joinNotes(base: string, notes: string[]): string {
  if (notes.length === 0) {
    return base;
  }
  if (base === "") {
    return notes.join(" ");
  }
  return `${base} ${notes.join(" ")}`;
}

function formatFloat(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function searchParams(req: ListingsSearchRequest, limit: number, offset: number): { params: Record<string, string>; echo: Record<string, unknown> } {
  const params: Record<string, string> = {};
  const echo: Record<string, unknown> = {};
  try {
    echo["intent"] = normalizeIntent(req.intent ?? "");
  } catch {
    // Echo skips an intent that already failed validation.
  }
  const city = (req.city ?? "").trim();
  if (city !== "") {
    params["city"] = city;
    echo["city"] = city;
  }
  let state = (req.state ?? "").trim();
  if (state !== "") {
    state = state.toUpperCase();
    params["state"] = state;
    echo["state"] = state;
  }
  const zip = (req.zipCode ?? "").trim();
  if (zip !== "") {
    params["zipCode"] = zip;
    echo["zip_code"] = zip;
  }
  const address = (req.address ?? "").trim();
  if (address !== "") {
    params["address"] = address;
    echo["address"] = address;
  }
  if ((req.latitude ?? 0) !== 0) {
    params["latitude"] = formatFloat(req.latitude ?? 0);
    echo["latitude"] = req.latitude;
  }
  if ((req.longitude ?? 0) !== 0) {
    params["longitude"] = formatFloat(req.longitude ?? 0);
    echo["longitude"] = req.longitude;
  }
  if ((req.radius ?? 0) > 0) {
    params["radius"] = formatFloat(req.radius ?? 0);
    echo["radius"] = req.radius;
  }
  const propertyType = normalizePropertyType(req.propertyType ?? "");
  if (propertyType !== "") {
    params["propertyType"] = propertyType;
    echo["property_type"] = propertyType;
  }
  const bedrooms = (req.bedrooms ?? "").trim();
  if (bedrooms !== "") {
    params["bedrooms"] = bedrooms;
    echo["bedrooms"] = bedrooms;
  }
  const bathrooms = (req.bathrooms ?? "").trim();
  if (bathrooms !== "") {
    params["bathrooms"] = bathrooms;
    echo["bathrooms"] = bathrooms;
  }
  const sqft = (req.squareFootage ?? "").trim();
  if (sqft !== "") {
    params["squareFootage"] = sqft;
    echo["square_footage"] = sqft;
  }
  const price = formatPriceRange(req.priceMin ?? 0, req.priceMax ?? 0);
  if (price !== "") {
    params["price"] = price;
    echo["price"] = price;
  }
  const daysOld = (req.daysOld ?? "").trim();
  if (daysOld !== "") {
    params["daysOld"] = daysOld;
    echo["days_old"] = daysOld;
  }
  const neighborhood = (req.neighborhood ?? "").trim();
  if (neighborhood !== "") {
    echo["neighborhood"] = neighborhood;
  }
  if ((req.zipFilter ?? []).length > 0) {
    echo["zip_filter"] = req.zipFilter;
  }
  if (req.newThisWeek === true) {
    echo["new_this_week"] = true;
  }
  if (req.petsWanted === true) {
    echo["pets_wanted"] = true;
  }
  if (req.parkingWanted === true) {
    echo["parking_wanted"] = true;
  }
  if (req.laundryWanted === true) {
    echo["laundry_wanted"] = true;
  }
  const status = (req.status ?? "").trim() === "" ? "Active" : (req.status ?? "").trim();
  params["status"] = status;
  echo["status"] = status;
  params["limit"] = String(limit);
  params["offset"] = String(offset);
  echo["limit"] = limit;
  echo["offset"] = offset;
  return { params, echo };
}

function propertyTypeIncludesLand(raw: string): boolean {
  const normalized = normalizePropertyType(raw);
  if (normalized === "") {
    return false;
  }
  return normalized.split("|").some((part) => part.trim().toLowerCase() === "land");
}

async function searchListings(
  client: RentalsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: ListingsSearchRequest,
  confirm: boolean,
): Promise<ListingsSearchResult> {
  const intent = normalizeIntent(req.intent ?? "");
  const expanded = expandListingsSearch({ ...req, intent });
  validateSearchRequest(expanded.req);
  const page = normalizePage(expanded.req.limit ?? 0, expanded.req.offset ?? 0);
  const { params, echo } = searchParams(expanded.req, page.limit, page.offset);
  params["includeTotalCount"] = "true";
  const { headers, body } = await getJSON(client, fetchFn, signal, listingsSearchPath(intent), params, confirm);
  const raw = Array.isArray(body) ? body : [];
  let listings = raw.map((item) => listingFromRaw(asRecord(item), intent));
  let filtered = false;
  const zipFilter = expanded.req.zipFilter ?? [];
  if (zipFilter.length > 1 || (zipFilter.length > 0 && (expanded.req.zipCode ?? "").trim() === "")) {
    const before = listings.length;
    listings = filterListingsByZips(listings, zipFilter);
    if (listings.length < before) {
      filtered = true;
      expanded.notes.push(`client zip filter kept ${String(listings.length)}/${String(before)} results`);
    }
  }
  let total = listings.length;
  if (!filtered) {
    const header = headers.get("X-Total-Count") ?? "";
    const parsed = Number.parseInt(header, 10);
    if (header !== "" && Number.isFinite(parsed) && parsed >= 0) {
      total = parsed;
    }
  }
  return {
    intent,
    listings,
    count: listings.length,
    total,
    limit: page.limit,
    offset: page.offset,
    summary: summarizeListings(listings, total, page.limit, page.offset, intent),
    query: echo,
    note: joinNotes(searchHandoffNote(intent), expanded.notes),
    usage: client.usage.snapshot(),
  };
}

async function getListing(
  client: RentalsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  id: string,
  intentRaw: string,
  confirm: boolean,
): Promise<ListingGetResult> {
  const trimmed = id.trim();
  if (trimmed === "") {
    throw new Error("listing id is required");
  }
  const intent = normalizeIntent(intentRaw);
  const { body } = await getJSON(client, fetchFn, signal, listingGetPath(trimmed, intent), null, confirm);
  return { listing: listingFromRaw(asRecord(body), intent), usage: client.usage.snapshot() };
}

async function rentEstimate(
  client: RentalsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: RentEstimateRequest,
  confirm: boolean,
): Promise<RentEstimateResult> {
  const address = (req.address ?? "").trim();
  if (address === "") {
    throw new Error("address is required");
  }
  const params: Record<string, string> = { address };
  const propertyType = normalizePropertyType(req.propertyType ?? "");
  if (propertyType !== "") {
    params["propertyType"] = propertyType;
  }
  const bedrooms = (req.bedrooms ?? "").trim();
  if (bedrooms !== "") {
    params["bedrooms"] = bedrooms;
  }
  const bathrooms = (req.bathrooms ?? "").trim();
  if (bathrooms !== "") {
    params["bathrooms"] = bathrooms;
  }
  const sqft = (req.squareFootage ?? "").trim();
  if (sqft !== "") {
    params["squareFootage"] = sqft;
  }
  const { body } = await getJSON(client, fetchFn, signal, "/avm/rent/long-term", params, confirm);
  const raw = asRecord(body);
  const subject = asRecord(raw.subjectProperty);
  const formatted = str(subject.formattedAddress).trim();
  return {
    address: formatted === "" ? address : formatted,
    rentEstimate: num(raw.rent),
    rentRangeLow: num(raw.rentRangeLow),
    rentRangeHigh: num(raw.rentRangeHigh),
    propertyType: str(subject.propertyType),
    bedrooms: num(subject.bedrooms),
    bathrooms: num(subject.bathrooms),
    note: "AVM estimate only — verify against live listings before deciding.",
    usage: client.usage.snapshot(),
  };
}

async function marketStats(
  client: RentalsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  zipCode: string,
  confirm: boolean,
): Promise<MarketStatsResult> {
  const zip = zipCode.trim();
  if (zip === "") {
    throw new Error("zip_code is required");
  }
  const { body } = await getJSON(client, fetchFn, signal, "/markets", {
    zipCode: zip,
    dataType: "Rental",
    historyRange: "1",
  }, confirm);
  const raw = asRecord(body);
  const rental = asRecord(raw.rentalData);
  const byType = Array.isArray(rental.dataByPropertyType) ? rental.dataByPropertyType : [];
  const outZip = str(raw.zipCode).trim();
  return {
    zipCode: outZip === "" ? zip : outZip,
    averageRent: num(rental.averageRent),
    medianRent: num(rental.medianRent),
    minRent: num(rental.minRent),
    maxRent: num(rental.maxRent),
    totalListings: intNum(rental.totalListings),
    newListings: intNum(rental.newListings),
    averageDaysOnMarket: num(rental.averageDaysOnMarket),
    medianDaysOnMarket: num(rental.medianDaysOnMarket),
    byPropertyType: byType.map((item) => {
      const row = asRecord(item);
      return {
        propertyType: str(row.propertyType),
        averageRent: num(row.averageRent),
        medianRent: num(row.medianRent),
        totalListings: intNum(row.totalListings),
      };
    }),
    note: "Zip-level rental aggregates. Pair with listings_search for concrete handoff candidates.",
    usage: client.usage.snapshot(),
  };
}

function listingsSearchPath(intent: string): string {
  return intent === intentBuy ? "/listings/sale" : "/listings/rental/long-term";
}

function listingGetPath(id: string, intent: string): string {
  const escaped = encodeURIComponent(id);
  return intent === intentBuy ? `/listings/sale/${escaped}` : `/listings/rental/long-term/${escaped}`;
}

async function getJSON(
  client: RentalsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  path: string,
  params: Record<string, string> | null,
  confirm: boolean,
): Promise<{ headers: Headers; body: unknown }> {
  if (client.apiKey.trim() === "") {
    throw new Error("RENTCAST_API_KEY is required");
  }
  const blocked = client.usage.gate(confirm);
  if (blocked !== null) {
    throw blocked;
  }
  const endpointPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${client.baseURL}${endpointPath}`);
  if (params !== null) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": client.apiKey,
        "User-Agent": userAgent,
      },
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? redact(err.message, client.apiKey) : "rentcast request failed";
    if (err instanceof Error) {
      err.message = message;
    }
    throw new Error(message, { cause: err });
  }
  const text = (await response.text()).slice(0, maxResponseBytes);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`rentcast HTTP ${String(response.status)}: ${truncate(text, 400)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseJSON(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    throw new Error(`decode rentcast response: ${message}`, { cause: err });
  }
  client.usage.recordSuccess();
  return { headers: response.headers, body: parsed };
}

function listingFromRaw(raw: Record<string, unknown>, intent: string): Listing {
  const listing: Listing = {
    id: str(raw.id),
    intent,
    formattedAddress: str(raw.formattedAddress),
    city: str(raw.city),
    state: str(raw.state),
    zipCode: str(raw.zipCode),
    propertyType: str(raw.propertyType),
    listingType: str(raw.listingType).trim(),
    bedrooms: num(raw.bedrooms),
    bathrooms: num(raw.bathrooms),
    squareFootage: num(raw.squareFootage),
    price: num(raw.price),
    status: str(raw.status),
    daysOnMarket: intNum(raw.daysOnMarket),
    listedDate: str(raw.listedDate),
    mlsName: str(raw.mlsName).trim(),
    mlsNumber: str(raw.mlsNumber).trim(),
    searchURL: "",
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    agent: contactFromRaw(raw.listingAgent),
    office: contactFromRaw(raw.listingOffice),
  };
  listing.searchURL = googleListingSearchURL(listingAddress(listing), intent);
  return listing;
}

function contactFromRaw(value: unknown): ListingContact | null {
  if (!isRecord(value)) {
    return null;
  }
  const contact: ListingContact = {
    name: str(value.name).trim(),
    phone: str(value.phone).trim(),
    email: str(value.email).trim(),
    website: str(value.website).trim(),
  };
  if ((contact.name ?? "") === "" && (contact.phone ?? "") === "" && (contact.email ?? "") === "" && (contact.website ?? "") === "") {
    return null;
  }
  return contact;
}

function listingAddress(listing: Listing): string {
  if (listing.formattedAddress.trim() !== "") {
    return listing.formattedAddress.trim();
  }
  return [listing.city, listing.state, listing.zipCode].filter((part) => part !== "").join(" ");
}

function shortAddress(listing: Listing): string {
  if (listing.formattedAddress !== "") {
    return listing.formattedAddress;
  }
  const parts = [listing.city, listing.state, listing.zipCode].filter((part) => part !== "");
  if (parts.length === 0) {
    return listing.id;
  }
  return parts.join(", ");
}

function formatListingPrice(price: number, intent: string): string {
  if (intent === intentBuy) {
    return `$${round0(price)}`;
  }
  return `$${round0(price)}/mo`;
}

function formatBeds(beds: number): string {
  if (beds === 0) {
    return "studio";
  }
  if (Number.isInteger(beds)) {
    return `${round0(beds)}bd`;
  }
  return `${String(beds)}bd`;
}

function orDefault(value: string, fallback: string): string {
  return value.trim() === "" ? fallback : value;
}

function omitString(out: Record<string, unknown>, key: string, value: string): void {
  if (value !== "") {
    out[key] = value;
  }
}

function omitNum(out: Record<string, unknown>, key: string, value: number): void {
  if (value !== 0) {
    out[key] = value;
  }
}

function contactJSON(contact: ListingContact | null): Record<string, unknown> | undefined {
  if (contact === null) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  omitString(out, "name", contact.name ?? "");
  omitString(out, "phone", contact.phone ?? "");
  omitString(out, "email", contact.email ?? "");
  omitString(out, "website", contact.website ?? "");
  return Object.keys(out).length === 0 ? undefined : out;
}

export function listingJSON(listing: Listing): Record<string, unknown> {
  const out: Record<string, unknown> = { id: listing.id };
  omitString(out, "intent", listing.intent);
  omitString(out, "formatted_address", listing.formattedAddress);
  omitString(out, "city", listing.city);
  omitString(out, "state", listing.state);
  omitString(out, "zip_code", listing.zipCode);
  omitString(out, "property_type", listing.propertyType);
  omitString(out, "listing_type", listing.listingType);
  out["bedrooms"] = listing.bedrooms;
  out["bathrooms"] = listing.bathrooms;
  omitNum(out, "square_footage", listing.squareFootage);
  omitNum(out, "price", listing.price);
  omitString(out, "status", listing.status);
  if (listing.daysOnMarket !== 0) {
    out["days_on_market"] = listing.daysOnMarket;
  }
  omitString(out, "listed_date", listing.listedDate);
  omitString(out, "mls_name", listing.mlsName);
  omitString(out, "mls_number", listing.mlsNumber);
  omitString(out, "search_url", listing.searchURL);
  omitNum(out, "latitude", listing.latitude);
  omitNum(out, "longitude", listing.longitude);
  const agent = contactJSON(listing.agent);
  if (agent !== undefined) {
    out["agent"] = agent;
  }
  const office = contactJSON(listing.office);
  if (office !== undefined) {
    out["office"] = office;
  }
  return out;
}

export function listingsSearchJSON(result: ListingsSearchResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    intent: result.intent,
    listings: result.listings.map(listingJSON),
    count: result.count,
  };
  if (result.total !== 0) {
    out["total"] = result.total;
  }
  out["limit"] = result.limit;
  out["offset"] = result.offset;
  omitString(out, "summary", result.summary);
  if (Object.keys(result.query).length > 0) {
    out["query"] = sortedRecord(result.query);
  }
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

export function listingGetJSON(result: ListingGetResult): Record<string, unknown> {
  const out = listingJSON(result.listing);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

export function rentEstimateJSON(result: RentEstimateResult): Record<string, unknown> {
  const out: Record<string, unknown> = { address: result.address };
  omitNum(out, "rent_estimate", result.rentEstimate);
  omitNum(out, "rent_range_low", result.rentRangeLow);
  omitNum(out, "rent_range_high", result.rentRangeHigh);
  omitString(out, "property_type", result.propertyType);
  omitNum(out, "bedrooms", result.bedrooms);
  omitNum(out, "bathrooms", result.bathrooms);
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

export function marketStatsJSON(result: MarketStatsResult): Record<string, unknown> {
  const out: Record<string, unknown> = { zip_code: result.zipCode };
  omitNum(out, "average_rent", result.averageRent);
  omitNum(out, "median_rent", result.medianRent);
  omitNum(out, "min_rent", result.minRent);
  omitNum(out, "max_rent", result.maxRent);
  if (result.totalListings !== 0) {
    out["total_listings"] = result.totalListings;
  }
  if (result.newListings !== 0) {
    out["new_listings"] = result.newListings;
  }
  omitNum(out, "average_days_on_market", result.averageDaysOnMarket);
  omitNum(out, "median_days_on_market", result.medianDaysOnMarket);
  if (result.byPropertyType.length > 0) {
    out["by_property_type"] = result.byPropertyType.map((row) => {
      const item: Record<string, unknown> = { property_type: row.propertyType };
      omitNum(item, "average_rent", row.averageRent);
      omitNum(item, "median_rent", row.medianRent);
      if (row.totalListings !== 0) {
        item["total_listings"] = row.totalListings;
      }
      return item;
    });
  }
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

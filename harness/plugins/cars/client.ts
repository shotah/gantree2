import type { Clock } from "@/harness/core/clock";
import type { Sql } from "@/harness/core/sql";
import { usageJSON, usageTracker, type Usage, type UsageTracker } from "@/harness/plugins/cars/usage";
import { asRecord, intNum, isRecord, num, parseJSON, redact, str, truncate } from "@/harness/plugins/cars/wire";

export const defaultBaseURL = "https://api.marketcheck.com/v2";
export const defaultRows = 10;
export const maxAgentRows = 50;
export const maxRadiusMiles = 100;
export const defaultRadius = 50;
const maxResponseBytes = 8 << 20;
const userAgent = "cars-search-mcp/1.0";

export type ListingsSearchRequest = {
  zip?: string;
  city?: string;
  state?: string;
  radius?: number;
  make?: string;
  model?: string;
  trim?: string;
  year?: number;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  milesMin?: number;
  milesMax?: number;
  bodyType?: string;
  carType?: string;
  sellerType?: string;
  rows?: number;
  start?: number;
};

export type ListingGetRequest = {
  id: string;
  sellerType?: string;
};

export type Listing = {
  id: string;
  heading?: string;
  price?: number;
  miles?: number;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  bodyType?: string;
  vin?: string;
  city?: string;
  state?: string;
  zip?: string;
  dealerName?: string;
  listingURL?: string;
  sellerType?: string;
  carType?: string;
  dom?: number;
  dist?: number;
};

export type ListingsSearchResult = {
  listings: Listing[];
  count: number;
  total: number;
  rows: number;
  start: number;
  summary?: string;
  note?: string;
  usage: Usage | null;
};

export type VINResult = {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  details?: Record<string, unknown>;
  note?: string;
  usage: Usage | null;
};

export type DealersSearchRequest = {
  zip?: string;
  city?: string;
  state?: string;
  radius?: number;
  dealerType?: string;
  rows?: number;
  start?: number;
};

export type Dealer = {
  id?: string;
  name?: string;
  dealerType?: string;
  inventoryURL?: string;
  listingCount?: number;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  dealershipGroupName?: string;
  dist?: number;
};

export type DealersSearchResult = {
  dealers: Dealer[];
  count: number;
  total: number;
  rows: number;
  start: number;
  note?: string;
  usage: Usage | null;
};

export type PricePredictRequest = {
  vin: string;
  miles: number;
  zip?: string;
  city?: string;
  state?: string;
  dealerType?: string;
  certified?: boolean;
};

export type PricePredictResult = {
  vin: string;
  miles?: number;
  predictedPrice?: number;
  msrp?: number;
  dealerType?: string;
  zip?: string;
  city?: string;
  state?: string;
  note?: string;
  usage: Usage | null;
};

export type ListingsStatsRequest = {
  zip?: string;
  city?: string;
  state?: string;
  radius?: number;
  make?: string;
  model?: string;
  trim?: string;
  year?: number;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  milesMin?: number;
  milesMax?: number;
  bodyType?: string;
  carType?: string;
};

export type FieldStats = {
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  count?: number;
};

export type ListingsStatsResult = {
  total: number;
  price?: FieldStats;
  miles?: FieldStats;
  dom?: FieldStats;
  make?: string;
  model?: string;
  zip?: string;
  note?: string;
  usage: Usage | null;
};

export type MarketStatsRequest = {
  year?: number;
  make: string;
  model: string;
  trim?: string;
  zip?: string;
  state?: string;
};

export type MarketStatsResult = {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mds?: number;
  activeInventory?: number;
  soldLast45Days?: number;
  note?: string;
  usage: Usage | null;
};

export type CarsClient = {
  apiKey: string;
  baseURL: string;
  usage: UsageTracker;
  searchListings(req: ListingsSearchRequest): Promise<ListingsSearchResult>;
  getListing(req: ListingGetRequest): Promise<Listing>;
  vinLookup(vin: string): Promise<VINResult>;
  searchDealers(req: DealersSearchRequest): Promise<DealersSearchResult>;
  predictPrice(req: PricePredictRequest): Promise<PricePredictResult>;
  listingsStats(req: ListingsStatsRequest): Promise<ListingsStatsResult>;
  marketStats(req: MarketStatsRequest): Promise<MarketStatsResult>;
  accountUsage(): Usage | null;
};

export function clientFromEnv(
  env: Readonly<Record<string, string>>,
  sql: Sql,
  clock: Clock,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): CarsClient {
  const key = (env.MARKETCHECK_API_KEY ?? "").trim();
  if (key === "") {
    throw new Error("MARKETCHECK_API_KEY is required");
  }
  const base = (env.MARKETCHECK_BASE_URL ?? "").trim().replace(/\/+$/, "");
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
}): CarsClient {
  const client: CarsClient = {
    apiKey: opts.apiKey,
    baseURL: opts.baseURL.replace(/\/+$/, "") || defaultBaseURL,
    usage: opts.usage,
    searchListings: (req) => searchListings(client, opts.fetch, opts.signal, req),
    getListing: (req) => getListing(client, opts.fetch, opts.signal, req),
    vinLookup: (vin) => vinLookup(client, opts.fetch, opts.signal, vin),
    searchDealers: (req) => searchDealers(client, opts.fetch, opts.signal, req),
    predictPrice: (req) => predictPrice(client, opts.fetch, opts.signal, req),
    listingsStats: (req) => listingsStats(client, opts.fetch, opts.signal, req),
    marketStats: (req) => marketStats(client, opts.fetch, opts.signal, req),
    accountUsage: () => opts.usage.snapshot(),
  };
  return client;
}

export function normalizeSellerType(raw: string): string {
  const s = raw.trim().toLowerCase();
  switch (s) {
    case "":
    case "dealer":
    case "dealership":
      return "dealer";
    case "fsbo":
    case "private":
    case "private_party":
    case "owner":
      return "fsbo";
    case "auction":
      return "auction";
    default:
      return s;
  }
}

export function normalizeCarType(raw: string): string {
  const s = raw.trim().toLowerCase();
  switch (s) {
    case "":
    case "used":
    case "preowned":
    case "pre-owned":
      return "used";
    case "new":
      return "new";
    case "certified":
    case "cpo":
      return "certified";
    default:
      return s;
  }
}

export function normalizeDealerType(raw: string): string {
  const s = raw.trim().toLowerCase();
  switch (s) {
    case "":
      return "";
    case "franchise":
    case "franchised":
      return "franchise";
    case "independent":
    case "indie":
      return "independent";
    default:
      return s;
  }
}

export function normalizeBodyType(raw: string): string {
  const s = raw.trim().toLowerCase();
  switch (s) {
    case "":
      return "";
    case "suv":
    case "crossover":
    case "cuv":
      return "SUV";
    case "truck":
    case "pickup":
    case "pick-up":
    case "pick_up":
      return "Pickup";
    case "sedan":
    case "car":
      return "Sedan";
    case "hatchback":
    case "hatch":
      return "Hatchback";
    case "coupe":
      return "Coupe";
    case "convertible":
    case "convertible_coupe":
      return "Convertible";
    case "van":
    case "minivan":
    case "mini_van":
      return "Van";
    case "wagon":
      return "Wagon";
    default:
      return raw.trim();
  }
}

export function validateSearchRequest(req: ListingsSearchRequest): void {
  const hasZip = (req.zip ?? "").trim() !== "";
  const hasCityState = (req.city ?? "").trim() !== "" && (req.state ?? "").trim() !== "";
  if (!hasZip && !hasCityState) {
    throw new Error("provide zip or city+state");
  }
  if ((req.radius ?? 0) > maxRadiusMiles) {
    throw new Error(`radius max is ${String(maxRadiusMiles)} miles (MarketCheck Free/Basic plan cap)`);
  }
}

export function normalizePage(rows: number, start: number): { rows: number; start: number } {
  let nextRows = rows;
  let nextStart = start;
  if (nextRows <= 0) {
    nextRows = defaultRows;
  }
  if (nextRows > maxAgentRows) {
    nextRows = maxAgentRows;
  }
  if (nextStart < 0) {
    nextStart = 0;
  }
  return { rows: nextRows, start: nextStart };
}

function formatDashRange(lo: number, hi: number): string {
  if (lo > 0 && hi > 0) {
    return `${String(lo)}-${String(hi)}`;
  }
  if (lo > 0) {
    return `${String(lo)}-`;
  }
  if (hi > 0) {
    return `0-${String(hi)}`;
  }
  return "";
}

function formatFloat(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function searchPath(seller: string): string {
  switch (seller) {
    case "fsbo":
      return "/search/car/fsbo/active";
    case "auction":
      return "/search/car/auction/active";
    default:
      return "/search/car/active";
  }
}

function listingPath(seller: string, id: string): string {
  const escaped = encodeURIComponent(id);
  switch (seller) {
    case "fsbo":
      return `/listing/car/fsbo/${escaped}`;
    case "auction":
      return `/listing/car/auction/${escaped}`;
    default:
      return `/listing/car/${escaped}`;
  }
}

function searchParams(req: ListingsSearchRequest, rows: number, start: number): { params: Record<string, string>; note: string } {
  const params: Record<string, string> = {};
  params["rows"] = String(rows);
  params["start"] = String(start);
  params["append_api_key"] = "false";
  params["car_type"] = normalizeCarType(req.carType ?? "");

  const notes = [
    "Present listing_url (VDP) to the human. Do not contact dealers, submit leads, or purchase vehicles.",
    "Free MarketCheck plan: ~500 calls/mo and 100-mile radius max — be thrifty on search.",
  ];

  const zip = (req.zip ?? "").trim();
  if (zip !== "") {
    params["zip"] = zip;
  }
  const city = (req.city ?? "").trim();
  if (city !== "") {
    params["city"] = city;
  }
  let state = (req.state ?? "").trim();
  if (state !== "") {
    state = state.toUpperCase();
    params["state"] = state;
  }

  let radius = req.radius ?? 0;
  if (radius <= 0 && (zip !== "" || city !== "")) {
    radius = defaultRadius;
    notes.push(`Defaulted radius to ${String(defaultRadius)} miles.`);
  }
  if (radius > 0) {
    params["radius"] = formatFloat(radius);
  }

  const make = (req.make ?? "").trim();
  if (make !== "") {
    params["make"] = make;
  }
  const model = (req.model ?? "").trim();
  if (model !== "") {
    params["model"] = model;
  }
  const trim = (req.trim ?? "").trim();
  if (trim !== "") {
    params["trim"] = trim;
  }
  const bodyType = normalizeBodyType(req.bodyType ?? "");
  if (bodyType !== "") {
    params["body_type"] = bodyType;
  }

  if ((req.year ?? 0) > 0) {
    params["year"] = String(req.year);
  } else {
    const yearRange = formatDashRange(req.yearMin ?? 0, req.yearMax ?? 0);
    if (yearRange !== "") {
      params["year_range"] = yearRange;
    }
  }
  const priceRange = formatDashRange(req.priceMin ?? 0, req.priceMax ?? 0);
  if (priceRange !== "") {
    params["price_range"] = priceRange;
  }
  const milesRange = formatDashRange(req.milesMin ?? 0, req.milesMax ?? 0);
  if (milesRange !== "") {
    params["miles_range"] = milesRange;
  }

  return { params, note: notes.join(" ") };
}

async function searchListings(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: ListingsSearchRequest,
): Promise<ListingsSearchResult> {
  validateSearchRequest(req);
  const page = normalizePage(req.rows ?? 0, req.start ?? 0);
  const seller = normalizeSellerType(req.sellerType ?? "");
  const path = searchPath(seller);
  const { params, note } = searchParams(req, page.rows, page.start);

  const raw = asRecord(await getJSON(client, fetchFn, signal, path, params));
  const listingsRaw = Array.isArray(raw.listings) ? raw.listings : [];
  const listings = listingsRaw.map((item) => listingFromRaw(asRecord(item), seller));

  return {
    listings,
    count: listings.length,
    total: intNum(raw.num_found),
    rows: page.rows,
    start: page.start,
    summary: summarizeListings(listings, intNum(raw.num_found), page.rows, page.start),
    note,
    usage: client.usage.snapshot(),
  };
}

async function getListing(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: ListingGetRequest,
): Promise<Listing> {
  const id = req.id.trim();
  if (id === "") {
    throw new Error("listing id is required");
  }
  const seller = normalizeSellerType(req.sellerType ?? "");
  const path = listingPath(seller, id);
  const raw = asRecord(await getJSON(client, fetchFn, signal, path, {}));
  return listingFromRaw(raw, seller);
}

async function vinLookup(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  vinRaw: string,
): Promise<VINResult> {
  const vin = vinRaw.trim().toUpperCase();
  if (vin === "") {
    throw new Error("vin is required");
  }
  if (vin.length !== 17) {
    throw new Error(`vin must be 17 characters (got ${String(vin.length)})`);
  }
  const path = `/decode/car/neovin/${encodeURIComponent(vin)}/specs`;
  const raw = asRecord(await getJSON(client, fetchFn, signal, path, {}));

  const out: VINResult = {
    vin,
    year: intFromAny(raw.year),
    make: stringFromAny(raw.make),
    model: stringFromAny(raw.model),
    trim: stringFromAny(raw.trim),
    details: raw,
    note: "NeoVIN enhanced decode (trim, options, fuel economy when available). Present listing_url from listings_search for handoff — do not contact dealers.",
    usage: client.usage.snapshot(),
  };
  const build = asRecord(raw.build);
  if (Object.keys(build).length > 0) {
    if ((out.year ?? 0) === 0) {
      out.year = intFromAny(build.year);
    }
    if ((out.make ?? "") === "") {
      out.make = stringFromAny(build.make);
    }
    if ((out.model ?? "") === "") {
      out.model = stringFromAny(build.model);
    }
    if ((out.trim ?? "") === "") {
      out.trim = stringFromAny(build.trim);
    }
  }
  return out;
}

async function searchDealers(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: DealersSearchRequest,
): Promise<DealersSearchResult> {
  const hasZip = (req.zip ?? "").trim() !== "";
  const hasCityState = (req.city ?? "").trim() !== "" && (req.state ?? "").trim() !== "";
  if (!hasZip && !hasCityState) {
    throw new Error("provide zip or city+state");
  }
  if ((req.radius ?? 0) > maxRadiusMiles) {
    throw new Error(`radius max is ${String(maxRadiusMiles)} miles (MarketCheck Free/Basic plan cap)`);
  }
  const page = normalizePage(req.rows ?? 0, req.start ?? 0);
  const params: Record<string, string> = {
    rows: String(page.rows),
    start: String(page.start),
  };
  const zip = (req.zip ?? "").trim();
  if (zip !== "") {
    params["zip"] = zip;
  }
  const city = (req.city ?? "").trim();
  if (city !== "") {
    params["city"] = city;
  }
  let state = (req.state ?? "").trim();
  if (state !== "") {
    state = state.toUpperCase();
    params["state"] = state;
  }
  let radius = req.radius ?? 0;
  if (radius <= 0) {
    radius = defaultRadius;
  }
  params["radius"] = formatFloat(radius);
  const dealerType = normalizeDealerType(req.dealerType ?? "");
  if (dealerType !== "") {
    params["dealer_type"] = dealerType;
  }

  const raw = asRecord(await getJSON(client, fetchFn, signal, "/dealers/car", params));
  const dealersRaw = Array.isArray(raw.dealers) ? raw.dealers : [];
  const dealers = dealersRaw.map((item) => dealerFromRaw(asRecord(item)));

  return {
    dealers,
    count: dealers.length,
    total: intNum(raw.num_found),
    rows: page.rows,
    start: page.start,
    note: "Dealer directory only — present inventory_url for handoff. Do not contact dealers or submit leads.",
    usage: client.usage.snapshot(),
  };
}

async function predictPrice(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: PricePredictRequest,
): Promise<PricePredictResult> {
  const vin = req.vin.trim().toUpperCase();
  if (vin === "") {
    throw new Error("vin is required");
  }
  if (vin.length !== 17) {
    throw new Error(`vin must be 17 characters (got ${String(vin.length)})`);
  }
  if ((req.miles ?? 0) <= 0) {
    throw new Error("miles is required (positive)");
  }
  const hasZip = (req.zip ?? "").trim() !== "";
  const hasCityState = (req.city ?? "").trim() !== "" && (req.state ?? "").trim() !== "";
  if (!hasZip && !hasCityState) {
    throw new Error("provide zip or city+state for local pricing");
  }

  let dealerType = normalizeDealerType(req.dealerType ?? "");
  if (dealerType === "") {
    dealerType = "franchise";
  }

  const params: Record<string, string> = {
    vin,
    miles: String(req.miles),
    dealer_type: dealerType,
  };
  const zip = (req.zip ?? "").trim();
  if (zip !== "") {
    params["zip"] = zip;
  }
  const city = (req.city ?? "").trim();
  if (city !== "") {
    params["city"] = city;
  }
  let state = (req.state ?? "").trim();
  if (state !== "") {
    state = state.toUpperCase();
    params["state"] = state;
  }
  if (req.certified === true) {
    params["is_certified"] = "true";
  }

  const raw = asRecord(await getJSON(client, fetchFn, signal, "/predict/car/us/marketcheck_price", params));
  return {
    vin,
    miles: req.miles,
    predictedPrice: num(raw.marketcheck_price),
    msrp: num(raw.msrp),
    dealerType,
    zip,
    city,
    state,
    note: "Predicted retail market price (MarketCheck Price™ US base). Compare with listings_search asking prices; not a purchase offer. Do not contact dealers.",
    usage: client.usage.snapshot(),
  };
}

async function listingsStats(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: ListingsStatsRequest,
): Promise<ListingsStatsResult> {
  const searchReq: ListingsSearchRequest = {
    zip: req.zip,
    city: req.city,
    state: req.state,
    radius: req.radius,
    make: req.make,
    model: req.model,
    trim: req.trim,
    year: req.year,
    yearMin: req.yearMin,
    yearMax: req.yearMax,
    priceMin: req.priceMin,
    priceMax: req.priceMax,
    milesMin: req.milesMin,
    milesMax: req.milesMax,
    bodyType: req.bodyType,
    carType: req.carType,
    rows: 1,
    start: 0,
  };
  validateSearchRequest(searchReq);
  const { params } = searchParams(searchReq, 1, 0);
  params["stats"] = "price,miles,dom";
  params["rows"] = "0";

  const raw = asRecord(await getJSON(client, fetchFn, signal, "/search/car/active", params));
  const stats = isRecord(raw.stats) ? raw.stats : {};

  return {
    total: intNum(raw.num_found),
    price: fieldStatsFromRaw(asRecord(stats.price)),
    miles: fieldStatsFromRaw(asRecord(stats.miles)),
    dom: fieldStatsFromRaw(asRecord(stats.dom)),
    make: (req.make ?? "").trim(),
    model: (req.model ?? "").trim(),
    zip: (req.zip ?? "").trim(),
    note: "Active inventory snapshot (price / miles / days-on-market aggregates). "
      + "Pair with markets_get for Market Days Supply, or listings_search for concrete handoff candidates.",
    usage: client.usage.snapshot(),
  };
}

async function marketStats(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  req: MarketStatsRequest,
): Promise<MarketStatsResult> {
  const makeName = req.make.trim();
  const modelName = req.model.trim();
  if (makeName === "" || modelName === "") {
    throw new Error("make and model are required");
  }

  const params: Record<string, string> = {
    make: makeName,
    model: modelName,
    car_type: "used",
  };
  if ((req.year ?? 0) > 0) {
    params["year"] = String(req.year);
  }
  const trim = (req.trim ?? "").trim();
  if (trim !== "") {
    params["trim"] = trim;
  }
  const zip = (req.zip ?? "").trim();
  if (zip !== "") {
    params["zip"] = zip;
    params["radius"] = String(defaultRadius);
  }
  let state = (req.state ?? "").trim();
  if (state !== "") {
    state = state.toUpperCase();
    params["state"] = state;
  }

  const raw = asRecord(await getJSON(client, fetchFn, signal, "/mds/car", params));
  return {
    year: req.year,
    make: makeName,
    model: modelName,
    trim,
    mds: num(raw.mds),
    activeInventory: intNum(raw.total_active_cars_for_ymmt),
    soldLast45Days: intNum(raw.total_cars_sold_in_last_45_days),
    note: "Market Days Supply = active inventory / (sold last 45 days / 45). "
      + "Lower MDS ≈ faster turnover. Pair with listings_search for concrete handoff candidates.",
    usage: client.usage.snapshot(),
  };
}

async function getJSON(
  client: CarsClient,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  if (client.apiKey.trim() === "") {
    throw new Error("MARKETCHECK_API_KEY is required");
  }
  const endpointPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${client.baseURL}${endpointPath}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  url.searchParams.set("api_key", client.apiKey);
  if (!url.searchParams.has("append_api_key")) {
    url.searchParams.set("append_api_key", "false");
  }

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      signal,
    });
  } catch (err) {
    const message = err instanceof Error ? redact(err.message, client.apiKey) : "marketcheck request failed";
    throw new Error(message, { cause: err });
  }
  const text = (await response.text()).slice(0, maxResponseBytes);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`marketcheck HTTP ${String(response.status)}: ${truncate(text, 400)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseJSON(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    throw new Error(`decode marketcheck response: ${message}`, { cause: err });
  }
  client.usage.recordSuccess();
  return parsed;
}

function listingFromRaw(raw: Record<string, unknown>, fallbackSeller: string): Listing {
  const listing: Listing = {
    id: str(raw.id),
    heading: str(raw.heading).trim() || undefined,
    price: num(raw.price) || undefined,
    miles: num(raw.miles) || undefined,
    vin: str(raw.vin).trim() || undefined,
    listingURL: str(raw.vdp_url).trim() || undefined,
    sellerType: str(raw.seller_type).trim() || fallbackSeller,
    carType: str(raw.inventory_type).trim() || undefined,
    dom: intNum(raw.dom) || undefined,
    dist: num(raw.dist) || undefined,
  };
  const build = asRecord(raw.build);
  if (Object.keys(build).length > 0) {
    listing.year = intNum(build.year) || undefined;
    listing.make = str(build.make).trim() || undefined;
    listing.model = str(build.model).trim() || undefined;
    listing.trim = str(build.trim).trim() || undefined;
    listing.bodyType = str(build.body_type).trim() || undefined;
  }
  const dealer = asRecord(raw.dealer);
  if (Object.keys(dealer).length > 0) {
    listing.dealerName = str(dealer.name).trim() || undefined;
    listing.city = str(dealer.city).trim() || listing.city;
    listing.state = str(dealer.state).trim() || listing.state;
    listing.zip = str(dealer.zip).trim() || listing.zip;
  }
  const carLocation = asRecord(raw.car_location);
  if (Object.keys(carLocation).length > 0) {
    if ((listing.dealerName ?? "") === "") {
      listing.dealerName = str(carLocation.seller_name).trim() || undefined;
    }
    listing.city = str(carLocation.city).trim() || listing.city;
    listing.state = str(carLocation.state).trim() || listing.state;
    listing.zip = str(carLocation.zip).trim() || listing.zip;
  }
  return listing;
}

function dealerFromRaw(raw: Record<string, unknown>): Dealer {
  return {
    id: str(raw.id).trim() || undefined,
    name: str(raw.seller_name).trim() || undefined,
    dealerType: str(raw.dealer_type).trim() || undefined,
    inventoryURL: str(raw.inventory_url).trim() || undefined,
    listingCount: intNum(raw.listing_count) || undefined,
    street: str(raw.street).trim() || undefined,
    city: str(raw.city).trim() || undefined,
    state: str(raw.state).trim() || undefined,
    zip: str(raw.zip).trim() || undefined,
    phone: str(raw.seller_phone).trim() || undefined,
    dealershipGroupName: str(raw.dealership_group_name).trim() || undefined,
    dist: num(raw.dist) || undefined,
  };
}

function fieldStatsFromRaw(raw: Record<string, unknown>): FieldStats | undefined {
  const count = intNum(raw.count);
  const min = num(raw.min);
  const max = num(raw.max);
  const mean = num(raw.mean);
  const median = num(raw.median);
  if (count === 0 && min === 0 && max === 0 && mean === 0 && median === 0) {
    return undefined;
  }
  return { min, max, mean, median, count };
}

function intFromAny(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringFromAny(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function orDefault(value: string, fallback: string): string {
  return value.trim() === "" ? fallback : value;
}

export function summarizeListings(listings: Listing[], total: number, rows: number, start: number): string {
  if (listings.length === 0) {
    return "No listings matched. Widen year/price/miles, try a nearby zip, or drop body_type.";
  }
  const ranked = [...listings].sort((a, b) => {
    const distA = a.dist ?? 0;
    const distB = b.dist ?? 0;
    if (distA !== distB && (distA > 0 || distB > 0)) {
      if (distA === 0) {
        return 1;
      }
      if (distB === 0) {
        return -1;
      }
      return distA - distB;
    }
    const priceA = a.price ?? 0;
    const priceB = b.price ?? 0;
    if (priceA !== priceB && (priceA > 0 || priceB > 0)) {
      if (priceA === 0) {
        return 1;
      }
      if (priceB === 0) {
        return -1;
      }
      return priceA - priceB;
    }
    const milesA = a.miles ?? 0;
    const milesB = b.miles ?? 0;
    if (milesA !== milesB && (milesA > 0 || milesB > 0)) {
      if (milesA === 0) {
        return 1;
      }
      if (milesB === 0) {
        return -1;
      }
      return milesA - milesB;
    }
    const domA = a.dom ?? 0;
    const domB = b.dom ?? 0;
    if (domA !== domB) {
      return domA - domB;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const n = Math.min(3, ranked.length);
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const listing = ranked[i];
    if (listing === undefined) {
      continue;
    }
    const label = [listing.year, listing.make, listing.model, listing.trim]
      .filter((part) => part !== undefined && part !== "")
      .join(" ")
      .trim();
    const title = label === "" ? orDefault(listing.heading ?? "", listing.id) : label;
    const price = (listing.price ?? 0) > 0 ? `$${String(Math.round(listing.price ?? 0))}` : "price n/a";
    const miles = (listing.miles ?? 0) > 0 ? `${String(listing.miles)} mi` : "miles n/a";
    parts.push(`${title} — ${price}, ${miles}, ${orDefault(listing.city ?? "", "?")} (${String(listing.dom ?? 0)} DOM)`);
  }

  let pageNote = `Showing ${String(listings.length)}`;
  if (total > listings.length) {
    pageNote = `Showing ${String(listings.length)} of ~${String(total)}`;
  }
  if (start > 0) {
    pageNote += ` (start ${String(start)})`;
  }
  void rows;
  return `${pageNote}. Top picks: ${parts.join("; ")}.`;
}

function omitString(out: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    out[key] = value;
  }
}

function omitNum(out: Record<string, unknown>, key: string, value: number | undefined): void {
  if (value !== undefined && value !== 0) {
    out[key] = value;
  }
}

export function listingJSON(listing: Listing): Record<string, unknown> {
  const out: Record<string, unknown> = { id: listing.id };
  omitString(out, "heading", listing.heading);
  omitNum(out, "price", listing.price);
  omitNum(out, "miles", listing.miles);
  if (listing.year !== undefined && listing.year !== 0) {
    out["year"] = listing.year;
  }
  omitString(out, "make", listing.make);
  omitString(out, "model", listing.model);
  omitString(out, "trim", listing.trim);
  omitString(out, "body_type", listing.bodyType);
  omitString(out, "vin", listing.vin);
  omitString(out, "city", listing.city);
  omitString(out, "state", listing.state);
  omitString(out, "zip", listing.zip);
  omitString(out, "dealer_name", listing.dealerName);
  omitString(out, "listing_url", listing.listingURL);
  omitString(out, "seller_type", listing.sellerType);
  omitString(out, "car_type", listing.carType);
  if (listing.dom !== undefined && listing.dom !== 0) {
    out["dom"] = listing.dom;
  }
  omitNum(out, "dist", listing.dist);
  return out;
}

export function listingsSearchJSON(result: ListingsSearchResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    listings: result.listings.map(listingJSON),
    count: result.count,
  };
  if (result.total !== 0) {
    out["total"] = result.total;
  }
  out["rows"] = result.rows;
  out["start"] = result.start;
  omitString(out, "summary", result.summary);
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

export function listingGetJSON(listing: Listing, usage: Usage | null): Record<string, unknown> {
  const out = listingJSON(listing);
  if (usage !== null) {
    out["usage"] = usageJSON(usage);
  }
  return out;
}

export function vinGetJSON(result: VINResult): Record<string, unknown> {
  const out: Record<string, unknown> = { vin: result.vin };
  if (result.year !== undefined && result.year !== 0) {
    out["year"] = result.year;
  }
  omitString(out, "make", result.make);
  omitString(out, "model", result.model);
  omitString(out, "trim", result.trim);
  if (result.details !== undefined) {
    out["details"] = result.details;
  }
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

export function dealersSearchJSON(result: DealersSearchResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    dealers: result.dealers.map(dealerJSON),
    count: result.count,
  };
  if (result.total !== 0) {
    out["total"] = result.total;
  }
  out["rows"] = result.rows;
  out["start"] = result.start;
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

function dealerJSON(dealer: Dealer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  omitString(out, "id", dealer.id);
  omitString(out, "name", dealer.name);
  omitString(out, "dealer_type", dealer.dealerType);
  omitString(out, "inventory_url", dealer.inventoryURL);
  if (dealer.listingCount !== undefined && dealer.listingCount !== 0) {
    out["listing_count"] = dealer.listingCount;
  }
  omitString(out, "street", dealer.street);
  omitString(out, "city", dealer.city);
  omitString(out, "state", dealer.state);
  omitString(out, "zip", dealer.zip);
  omitString(out, "phone", dealer.phone);
  omitString(out, "dealership_group_name", dealer.dealershipGroupName);
  omitNum(out, "dist", dealer.dist);
  return out;
}

export function pricePredictJSON(result: PricePredictResult): Record<string, unknown> {
  const out: Record<string, unknown> = { vin: result.vin };
  if (result.miles !== undefined && result.miles !== 0) {
    out["miles"] = result.miles;
  }
  omitNum(out, "predicted_price", result.predictedPrice);
  omitNum(out, "msrp", result.msrp);
  omitString(out, "dealer_type", result.dealerType);
  omitString(out, "zip", result.zip);
  omitString(out, "city", result.city);
  omitString(out, "state", result.state);
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

function fieldStatsJSON(stats: FieldStats | undefined): Record<string, unknown> | undefined {
  if (stats === undefined) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  omitNum(out, "min", stats.min);
  omitNum(out, "max", stats.max);
  omitNum(out, "mean", stats.mean);
  omitNum(out, "median", stats.median);
  if (stats.count !== undefined && stats.count !== 0) {
    out["count"] = stats.count;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function listingsStatsJSON(result: ListingsStatsResult): Record<string, unknown> {
  const out: Record<string, unknown> = { total: result.total };
  const price = fieldStatsJSON(result.price);
  if (price !== undefined) {
    out["price"] = price;
  }
  const miles = fieldStatsJSON(result.miles);
  if (miles !== undefined) {
    out["miles"] = miles;
  }
  const dom = fieldStatsJSON(result.dom);
  if (dom !== undefined) {
    out["dom"] = dom;
  }
  omitString(out, "make", result.make);
  omitString(out, "model", result.model);
  omitString(out, "zip", result.zip);
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

export function marketStatsJSON(result: MarketStatsResult): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (result.year !== undefined && result.year !== 0) {
    out["year"] = result.year;
  }
  omitString(out, "make", result.make);
  omitString(out, "model", result.model);
  omitString(out, "trim", result.trim);
  omitNum(out, "mds", result.mds);
  if (result.activeInventory !== undefined && result.activeInventory !== 0) {
    out["active_inventory"] = result.activeInventory;
  }
  if (result.soldLast45Days !== undefined && result.soldLast45Days !== 0) {
    out["sold_last_45_days"] = result.soldLast45Days;
  }
  omitString(out, "note", result.note);
  if (result.usage !== null) {
    out["usage"] = usageJSON(result.usage);
  }
  return out;
}

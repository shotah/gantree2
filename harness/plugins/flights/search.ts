import { getJSON, usageOrNil, type SerpClient } from "./client";
import { applyAirlineParams, applyFlyAmerica } from "./filters";
import type {
  AirportHit,
  AirportsSearchResult,
  CarbonInfo,
  DatePrice,
  DatesSearchRequest,
  DatesSearchResult,
  FlightOffer,
  FlightSegment,
  OfferSearchRequest,
  OfferSearchResult,
  PriceHistoryPoint,
  PriceInsights,
} from "./types";
import { buildGoogleFlightsURL } from "./url";
import { asArray, asRecord, num, round0, str } from "./wire";

const TRIP_ROUND = 1;
const TRIP_ONE_WAY = 2;
const CLASS_ECONOMY = 1;
const CLASS_PREMIUM = 2;
const CLASS_BUSINESS = 3;
const CLASS_FIRST = 4;
const STOPS_ANY = 0;
const STOPS_NONSTOP = 1;
const STOPS_ONE = 2;
const STOPS_TWO = 3;
const SORT_TOP = 1;
const SORT_PRICE = 2;
const SORT_DURATION = 5;

export function parseTravelClass(value: string): number {
  switch (value.trim().toLowerCase()) {
    case "":
    case "economy":
      return CLASS_ECONOMY;
    case "premium_economy":
    case "premium-economy":
    case "premium":
      return CLASS_PREMIUM;
    case "business":
      return CLASS_BUSINESS;
    case "first":
      return CLASS_FIRST;
    default:
      throw new Error("travel_class must be economy, premium_economy, business, or first");
  }
}

export function parseStops(value: string): number {
  switch (value.trim().toLowerCase()) {
    case "":
    case "any":
      return STOPS_ANY;
    case "nonstop":
    case "non-stop":
    case "0":
      return STOPS_NONSTOP;
    case "1_or_fewer":
    case "1":
    case "one_or_fewer":
      return STOPS_ONE;
    case "2_or_fewer":
    case "2":
    case "two_or_fewer":
      return STOPS_TWO;
    default:
      throw new Error("stops must be any, nonstop, 1_or_fewer, or 2_or_fewer");
  }
}

export function parseSort(value: string): number {
  switch (value.trim().toLowerCase()) {
    case "":
    case "top":
      return SORT_TOP;
    case "price":
      return SORT_PRICE;
    case "duration":
      return SORT_DURATION;
    default:
      throw new Error("sort_by must be top, price, or duration");
  }
}

function parseISODate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function formatISODate(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUTCDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function validateOfferRequest(req: OfferSearchRequest): void {
  if (req.origin.trim() === "" || req.destination.trim() === "") {
    throw new Error("origin and destination are required (IATA codes or Google location ids)");
  }
  if (parseISODate(req.outboundDate) === null) {
    throw new Error("outbound_date must be YYYY-MM-DD");
  }
  const ret = req.returnDate?.trim() ?? "";
  if (ret !== "" && parseISODate(ret) === null) {
    throw new Error("return_date must be YYYY-MM-DD");
  }
}

export function offerParams(req: OfferSearchRequest): Record<string, string> {
  const params: Record<string, string> = {
    engine: "google_flights",
    departure_id: req.origin.trim(),
    arrival_id: req.destination.trim(),
    outbound_date: req.outboundDate,
  };
  let trip = TRIP_ONE_WAY;
  const ret = req.returnDate?.trim() ?? "";
  if (ret !== "") {
    trip = TRIP_ROUND;
    params.return_date = ret;
  }
  params.type = String(trip);
  const adults = req.adults !== undefined && req.adults > 0 ? req.adults : 1;
  params.adults = String(adults);
  params.travel_class = String(parseTravelClass(req.travelClass ?? ""));
  const stops = parseStops(req.stops ?? "");
  if (stops !== STOPS_ANY) {
    params.stops = String(stops);
  }
  params.sort_by = String(parseSort(req.sortBy ?? ""));
  params.currency = req.currency === undefined || req.currency === "" ? "USD" : req.currency;
  params.gl = req.country === undefined || req.country === "" ? "us" : req.country;
  params.hl = req.language === undefined || req.language === "" ? "en" : req.language;
  if (req.maxPrice !== undefined && req.maxPrice > 0) {
    params.max_price = String(req.maxPrice);
  }
  if (req.deepSearch === true) {
    params.deep_search = "true";
  }
  const airlines = applyAirlineParams(req.includeAirlines ?? "", req.excludeAirlines ?? "");
  if (airlines.inc !== "") {
    params.include_airlines = airlines.inc;
  }
  if (airlines.exc !== "") {
    params.exclude_airlines = airlines.exc;
  }
  if (req.excludeBasic === true) {
    params.exclude_basic = "true";
  }
  return params;
}

function formatDuration(mins: number): string {
  if (mins <= 0) {
    return "";
  }
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours === 0) {
    return `${String(minutes)}m`;
  }
  if (minutes === 0) {
    return `${String(hours)}h`;
  }
  return `${String(hours)}h${String(minutes)}m`;
}

export function summarizeOffer(offer: FlightOffer): string {
  const airline = offer.airlines !== undefined && offer.airlines.length > 0 ? offer.airlines.join("/") : "unknown";
  let stops = "nonstop";
  if (offer.stops === 1) {
    stops = "1 stop";
  } else if (offer.stops > 1) {
    stops = `${String(offer.stops)} stops`;
  }
  const parts = [`${round0(offer.price)} ${offer.currency ?? ""}`, airline, stops];
  if (offer.totalDurationMin !== undefined && offer.totalDurationMin > 0) {
    parts.push(formatDuration(offer.totalDurationMin));
  }
  const dep = offer.departureAirport ?? "";
  const arr = offer.arrivalAirport ?? "";
  let route = `${dep} → ${arr}`.trim();
  if ((offer.departureTime ?? "") !== "" || (offer.arrivalTime ?? "") !== "") {
    route = `${dep} ${offer.departureTime ?? ""} → ${arr} ${offer.arrivalTime ?? ""}`;
  }
  if (route.trim() !== "→" && route !== "") {
    parts.push(route);
  }
  if (offer.layovers !== undefined && offer.layovers.length > 0) {
    parts.push(`layovers ${offer.layovers.join(", ")}`);
  }
  if (offer.carbon !== undefined && offer.carbon.differencePercent !== undefined && offer.carbon.differencePercent !== 0) {
    const diff = offer.carbon.differencePercent;
    const sign = diff > 0 ? "+" : "";
    parts.push(`CO₂ ${sign}${round0(diff)}% vs typical`);
  }
  return parts.join(" · ");
}

function stopLabel(stops: number): string {
  if (stops === 0) {
    return "nonstop";
  }
  if (stops === 1) {
    return "1 stop";
  }
  return `${String(stops)} stops`;
}

export function recommendOffers(res: OfferSearchResult): string {
  if (res.offers.length === 0) {
    return "No flight offers returned for these dates. Try nearby airports (airports_search) or flexible dates (dates_search).";
  }
  let best = res.offers[0];
  let bestIdx = 0;
  if (best === undefined) {
    return "No flight offers returned for these dates. Try nearby airports (airports_search) or flexible dates (dates_search).";
  }
  for (let i = 1; i < res.offers.length; i += 1) {
    const offer = res.offers[i];
    if (offer === undefined) {
      continue;
    }
    if (offer.price > 0 && (best.price === 0 || offer.price < best.price)) {
      best = offer;
      bestIdx = i;
    }
  }
  let pick = best;
  let pickIdx = bestIdx;
  if (best.stops > 0) {
    for (let i = 0; i < res.offers.length; i += 1) {
      const offer = res.offers[i];
      if (offer === undefined || offer.stops !== 0 || offer.price <= 0) {
        continue;
      }
      if (offer.price <= best.price * 1.15 && (pick.stops > 0 || offer.price < pick.price)) {
        pick = offer;
        pickIdx = i;
      }
    }
  }
  let msg = `Recommend offer #${String(pickIdx + 1)}: ${pick.summary ?? ""}.`;
  if (pickIdx !== bestIdx) {
    msg += ` (cheapest is #${String(bestIdx + 1)} at ${round0(best.price)} ${res.currency} with ${stopLabel(best.stops)})`;
  }
  const insights = res.priceInsights;
  if (insights?.priceLevel !== undefined && insights.priceLevel !== "") {
    msg += ` Google price level: ${insights.priceLevel}`;
    if (insights.typicalPriceLow !== undefined && insights.typicalPriceLow > 0) {
      msg += ` (typical ${round0(insights.typicalPriceLow)}–${round0(insights.typicalPriceHigh ?? 0)} ${res.currency})`;
    }
    msg += ".";
    const level = insights.priceLevel.toLowerCase();
    if (level === "low" || level === "typically low") {
      msg += " Fare looks favorable vs recent history.";
    } else if (level === "high" || level === "typically high") {
      msg += " Fare looks expensive — consider dates_search for cheaper days.";
    }
    const history = insights.priceHistory?.length ?? 0;
    if (history > 0) {
      msg += ` price_history has ${String(history)} samples.`;
    }
  }
  msg += " For real checkout call booking_options_get with booking_token"
    + " (round-trip: returns_search with departure_token first)."
    + " Do not invent #flt= links; google_flights_url is a search fallback only.";
  return msg;
}

type RawLeg = {
  departureId: string;
  departureTime: string;
  arrivalId: string;
  arrivalTime: string;
  duration: number;
  airplane: string;
  airline: string;
  travelClass: string;
  flightNumber: string;
};

function readLeg(value: unknown): RawLeg {
  const raw = asRecord(value);
  const dep = asRecord(raw.departure_airport);
  const arr = asRecord(raw.arrival_airport);
  return {
    departureId: str(dep.id),
    departureTime: str(dep.time),
    arrivalId: str(arr.id),
    arrivalTime: str(arr.time),
    duration: num(raw.duration),
    airplane: str(raw.airplane),
    airline: str(raw.airline),
    travelClass: str(raw.travel_class),
    flightNumber: str(raw.flight_number),
  };
}

export function normalizeOffer(raw: Record<string, unknown>, currency: string): FlightOffer {
  const legs = asArray(raw.flights).map(readLeg);
  const offer: FlightOffer = {
    price: num(raw.price),
    currency,
    stops: 0,
  };
  const duration = num(raw.total_duration);
  if (duration > 0) {
    offer.totalDurationMin = duration;
  }
  const departureToken = str(raw.departure_token);
  const bookingToken = str(raw.booking_token);
  if (departureToken !== "") {
    offer.departureToken = departureToken;
  }
  if (bookingToken !== "") {
    offer.bookingToken = bookingToken;
  }
  const seen = new Set<string>();
  const airlines: string[] = [];
  const flights: FlightSegment[] = [];
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg === undefined) {
      continue;
    }
    const seg: FlightSegment = {};
    if (leg.airline !== "") {
      seg.airline = leg.airline;
    }
    if (leg.flightNumber !== "") {
      seg.flightNumber = leg.flightNumber;
    }
    if (leg.airplane !== "") {
      seg.airplane = leg.airplane;
    }
    if (leg.travelClass !== "") {
      seg.travelClass = leg.travelClass;
    }
    if (leg.departureId !== "") {
      seg.departureId = leg.departureId;
    }
    if (leg.arrivalId !== "") {
      seg.arrivalId = leg.arrivalId;
    }
    if (leg.departureTime !== "") {
      seg.departureTime = leg.departureTime;
    }
    if (leg.arrivalTime !== "") {
      seg.arrivalTime = leg.arrivalTime;
    }
    if (leg.duration > 0) {
      seg.durationMin = leg.duration;
    }
    flights.push(seg);
    if (leg.airline !== "" && !seen.has(leg.airline)) {
      seen.add(leg.airline);
      airlines.push(leg.airline);
    }
    if (i === 0) {
      if (leg.departureId !== "") {
        offer.departureAirport = leg.departureId;
      }
      if (leg.departureTime !== "") {
        offer.departureTime = leg.departureTime;
      }
    }
    if (i === legs.length - 1) {
      if (leg.arrivalId !== "") {
        offer.arrivalAirport = leg.arrivalId;
      }
      if (leg.arrivalTime !== "") {
        offer.arrivalTime = leg.arrivalTime;
      }
    }
  }
  if (flights.length > 0) {
    offer.flights = flights;
  }
  if (airlines.length > 0) {
    offer.airlines = airlines;
  }
  offer.stops = Math.max(0, legs.length - 1);
  const layovers: string[] = [];
  for (const item of asArray(raw.layovers)) {
    const layover = asRecord(item);
    let label = str(layover.id);
    if (label === "") {
      label = str(layover.name);
    }
    const layoverDuration = num(layover.duration);
    if (layoverDuration > 0) {
      label = `${label} (${String(layoverDuration)}m)`;
    }
    layovers.push(label);
  }
  if (layovers.length > 0) {
    offer.layovers = layovers;
  }
  if (isPresent(raw.carbon_emissions)) {
    const carbon = asRecord(raw.carbon_emissions);
    const info: CarbonInfo = {};
    const thisFlight = num(carbon.this_flight);
    const typical = num(carbon.typical_for_this_route);
    const diff = num(carbon.difference_percent);
    if (thisFlight !== 0) {
      info.thisFlight = thisFlight;
    }
    if (typical !== 0) {
      info.typicalForRoute = typical;
    }
    if (diff !== 0) {
      info.differencePercent = diff;
    }
    offer.carbon = info;
  }
  offer.summary = summarizeOffer(offer);
  return offer;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function normalizePriceHistory(raw: unknown): PriceHistoryPoint[] | undefined {
  const rows = asArray(raw);
  if (rows.length === 0) {
    return undefined;
  }
  const out: PriceHistoryPoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) {
      continue;
    }
    out.push({ timestamp: Math.trunc(num(row[0])), price: num(row[1]) });
  }
  if (out.length === 0) {
    return undefined;
  }
  return out;
}

function readInsights(raw: unknown): PriceInsights | undefined {
  if (!isPresent(raw)) {
    return undefined;
  }
  const record = asRecord(raw);
  const insights: PriceInsights = {};
  const lowest = num(record.lowest_price);
  const level = str(record.price_level);
  if (lowest !== 0) {
    insights.lowestPrice = lowest;
  }
  if (level !== "") {
    insights.priceLevel = level;
  }
  const range = asArray(record.typical_price_range);
  if (range.length >= 2) {
    insights.typicalPriceLow = num(range[0]);
    insights.typicalPriceHigh = num(range[1]);
  }
  const history = normalizePriceHistory(record.price_history);
  if (history !== undefined) {
    insights.priceHistory = history;
  }
  return insights;
}

function readOffers(raw: Record<string, unknown>, currency: string, maxResults: number): FlightOffer[] {
  const merged = [...asArray(raw.best_flights), ...asArray(raw.other_flights)];
  const offers: FlightOffer[] = [];
  const limit = maxResults <= 0 ? merged.length : maxResults;
  for (let i = 0; i < merged.length && i < limit; i += 1) {
    offers.push(normalizeOffer(asRecord(merged[i]), currency));
  }
  return offers;
}

async function searchOffers(client: SerpClient, req: OfferSearchRequest): Promise<OfferSearchResult> {
  validateOfferRequest(req);
  const params = offerParams(req);
  const raw = asRecord(await getJSON(client, "/search.json", params));
  const searchParams = asRecord(raw.search_parameters);
  let currency = req.currency ?? "";
  if (currency === "") {
    currency = str(searchParams.currency);
  }
  if (currency === "") {
    currency = "USD";
  }
  const maxResults = req.maxResults !== undefined && req.maxResults > 0 ? req.maxResults : 10;
  const ret = req.returnDate?.trim() ?? "";
  const metadata = asRecord(raw.search_metadata);
  let url = str(metadata.google_flights_url);
  if (url === "") {
    url = buildGoogleFlightsURL({
      origin: req.origin,
      destination: req.destination,
      outboundDate: req.outboundDate,
      returnDate: ret,
      currency,
      country: req.country,
      language: req.language,
    });
  }
  const out: OfferSearchResult = {
    tripType: ret === "" ? "one_way" : "round_trip",
    origin: req.origin.trim().toUpperCase(),
    destination: req.destination.trim().toUpperCase(),
    outboundDate: req.outboundDate,
    currency,
    googleFlightsUrl: url,
    offers: readOffers(raw, currency, maxResults),
  };
  if (ret !== "") {
    out.returnDate = ret;
  }
  const insights = readInsights(raw.price_insights);
  if (insights !== undefined) {
    out.priceInsights = insights;
  }
  applyFlyAmerica(out, req.flyAmerica ?? "", req.funding ?? "");
  out.recommendation = recommendOffers(out);
  return out;
}

export async function searchOffersWithUsage(client: SerpClient, req: OfferSearchRequest): Promise<OfferSearchResult> {
  const out = await searchOffers(client, req);
  const usage = await usageOrNil(client);
  if (usage !== undefined) {
    out.usage = usage;
  }
  return out;
}

export function sampleDates(start: Date, end: Date, count: number): Date[] {
  const days = Math.max(Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1, 1);
  let n = count;
  if (n > days) {
    n = days;
  }
  if (n === 1) {
    return [start];
  }
  const out: Date[] = [];
  for (let i = 0; i < n; i += 1) {
    const offset = Math.floor((i * (days - 1)) / (n - 1));
    out.push(addUTCDays(start, offset));
  }
  return out;
}

type DateStayPlan = { outbound: Date; stayNights: number };

export function resolveStayRange(fixed: number, minN: number, maxN: number): { min: number; max: number } {
  if (minN === 0 && maxN === 0) {
    return { min: fixed, max: fixed };
  }
  if (minN < 0 || maxN < 0) {
    throw new Error("stay_nights_min/max must be >= 0");
  }
  let lo = minN;
  let hi = maxN;
  if (lo > 0 && hi === 0) {
    hi = lo;
  }
  if (hi > 0 && lo === 0) {
    lo = hi;
  }
  if (hi < lo) {
    throw new Error("stay_nights_max must be >= stay_nights_min");
  }
  if (fixed > 0) {
    return { min: fixed, max: fixed };
  }
  return { min: lo, max: hi };
}

export function sampleDateStayPlans(start: Date, end: Date, stayMin: number, stayMax: number, count: number): DateStayPlan[] {
  if (stayMax <= 0) {
    return sampleDates(start, end, count).map((outbound) => ({ outbound, stayNights: 0 }));
  }
  const lo = stayMin <= 0 ? stayMax : stayMin;
  const stays = Math.max(stayMax - lo + 1, 1);
  const dates = sampleDates(start, end, count);
  if (dates.length === 0) {
    return [];
  }
  const out: DateStayPlan[] = [];
  for (let i = 0; i < count; i += 1) {
    const outbound = dates[i % dates.length];
    if (outbound === undefined) {
      continue;
    }
    out.push({ outbound, stayNights: lo + (i % stays) });
  }
  return out;
}

function recommendDates(out: DatesSearchResult, best: DatePrice | undefined, sampleCount: number): string {
  if (best === undefined || (best.lowestPrice ?? 0) <= 0) {
    return "No priced samples in this window — widen dates or check airport codes via airports_search.";
  }
  const price = best.lowestPrice ?? 0;
  if ((out.stayNights ?? 0) > 0) {
    return `Cheapest sampled round-trip: depart ${best.outboundDate}, return ${best.returnDate ?? ""} (${String(out.stayNights)} nights) at ${round0(price)} ${out.currency} across ${String(sampleCount)} samples. Confirm with offers_search before buying.`;
  }
  return `Cheapest sampled departure is ${best.outboundDate} at ${round0(price)} ${out.currency} (${String(sampleCount)} sample days). Confirm with offers_search before buying.`;
}

export async function searchDates(client: SerpClient, req: DatesSearchRequest): Promise<DatesSearchResult> {
  const origin = req.origin.trim();
  const destination = req.destination.trim();
  if (origin === "" || destination === "") {
    throw new Error("origin and destination are required");
  }
  const start = parseISODate(req.startDate);
  if (start === null) {
    throw new Error("start_date must be YYYY-MM-DD");
  }
  const end = parseISODate(req.endDate);
  if (end === null) {
    throw new Error("end_date must be YYYY-MM-DD");
  }
  if (end.getTime() < start.getTime()) {
    throw new Error("end_date must be on or after start_date");
  }
  const stayNights = req.stayNights ?? 0;
  if (stayNights < 0) {
    throw new Error("stay_nights must be >= 0");
  }
  const range = resolveStayRange(stayNights, req.stayNightsMin ?? 0, req.stayNightsMax ?? 0);
  let maxSamples = req.maxSamples ?? 0;
  if (maxSamples <= 0) {
    maxSamples = 5;
  }
  if (maxSamples > 7) {
    maxSamples = 7;
  }
  const currency = req.currency === undefined || req.currency === "" ? "USD" : req.currency;
  const travelClass = req.travelClass === undefined || req.travelClass === "" ? "economy" : req.travelClass;
  const plans = sampleDateStayPlans(start, end, range.min, range.max, maxSamples);
  const out: DatesSearchResult = {
    tripType: range.max > 0 ? "round_trip" : "one_way",
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    startDate: req.startDate,
    endDate: req.endDate,
    currency,
    samples: [],
  };
  if (stayNights > 0) {
    out.stayNights = stayNights;
  }
  let best: DatePrice | undefined;
  for (const plan of plans) {
    const day = formatISODate(plan.outbound);
    const sample: DatePrice = { outboundDate: day, currency, stops: 0 };
    const offerReq: OfferSearchRequest = {
      origin,
      destination,
      outboundDate: day,
      adults: 1,
      travelClass,
      stops: req.stops,
      sortBy: "price",
      currency,
      maxResults: 1,
      includeAirlines: req.includeAirlines,
      excludeAirlines: req.excludeAirlines,
    };
    if (plan.stayNights > 0) {
      const ret = formatISODate(addUTCDays(plan.outbound, plan.stayNights));
      sample.returnDate = ret;
      offerReq.returnDate = ret;
    }
    try {
      const res = await searchOffers(client, offerReq);
      const first = res.offers[0];
      if (first === undefined) {
        sample.error = "no offers";
      } else {
        sample.lowestPrice = first.price;
        sample.stops = first.stops;
        if (first.totalDurationMin !== undefined) {
          sample.durationMin = first.totalDurationMin;
        }
        if (first.summary !== undefined) {
          sample.summary = first.summary;
        }
        const airline = first.airlines?.[0];
        if (airline !== undefined) {
          sample.airline = airline;
        }
        if (best === undefined || (sample.lowestPrice > 0 && sample.lowestPrice < (best.lowestPrice ?? 0))) {
          best = { ...sample };
        }
      }
    } catch (err) {
      sample.error = err instanceof Error ? err.message : "search failed";
    }
    out.samples.push(sample);
  }
  out.recommendation = recommendDates(out, best, plans.length);
  if (best !== undefined && (best.lowestPrice ?? 0) > 0) {
    out.cheapestDate = best.outboundDate;
    if (best.returnDate !== undefined) {
      out.cheapestReturn = best.returnDate;
    }
    out.cheapestPrice = best.lowestPrice;
  }
  const usage = await usageOrNil(client);
  if (usage !== undefined) {
    out.usage = usage;
  }
  return out;
}

export async function searchAirports(client: SerpClient, query: string, country: string, language: string): Promise<AirportsSearchResult> {
  const q = query.trim();
  if (q === "") {
    throw new Error("query is required");
  }
  const gl = country === "" ? "us" : country;
  const hl = language === "" ? "en" : language;
  const raw = asRecord(await getJSON(client, "/search.json", {
    engine: "google_flights_autocomplete",
    q,
    gl,
    hl,
  }));
  const suggestions: AirportHit[] = [];
  for (const item of asArray(raw.suggestions)) {
    const suggestion = asRecord(item);
    const hit: AirportHit = { name: str(suggestion.name) };
    const type = str(suggestion.type);
    const id = str(suggestion.id);
    const description = str(suggestion.description);
    if (type !== "") {
      hit.type = type;
    }
    if (id !== "") {
      hit.id = id;
    }
    if (description !== "") {
      hit.description = description;
    }
    const airports = [];
    for (const airport of asArray(suggestion.airports)) {
      const brief = asRecord(airport);
      const entry = { name: str(brief.name), id: str(brief.id) };
      const city = str(brief.city);
      const distance = str(brief.distance);
      airports.push({
        ...entry,
        ...(city === "" ? {} : { city }),
        ...(distance === "" ? {} : { distance }),
      });
    }
    if (airports.length > 0) {
      hit.airports = airports;
    }
    suggestions.push(hit);
  }
  const out: AirportsSearchResult = { query: q, suggestions };
  const usage = await usageOrNil(client);
  if (usage !== undefined) {
    out.usage = usage;
  }
  return out;
}

export async function selectDeparture(client: SerpClient, departureToken: string, currency: string, country: string, language: string): Promise<OfferSearchResult> {
  const token = departureToken.trim();
  if (token === "") {
    throw new Error("departure_token is required (from offers_search outbound results)");
  }
  let curr = currency === "" ? "USD" : currency;
  const gl = country === "" ? "us" : country;
  const hl = language === "" ? "en" : language;
  const raw = asRecord(await getJSON(client, "/search.json", {
    engine: "google_flights",
    departure_token: token,
    currency: curr,
    gl,
    hl,
  }));
  const searchParams = asRecord(raw.search_parameters);
  const fromSearch = str(searchParams.currency);
  if (fromSearch !== "") {
    curr = fromSearch;
  }
  const offers = readOffers(raw, curr, 0);
  const metadata = asRecord(raw.search_metadata);
  const out: OfferSearchResult = {
    tripType: "round_trip",
    origin: "",
    destination: "",
    outboundDate: "",
    currency: curr,
    offers,
  };
  const url = str(metadata.google_flights_url);
  if (url !== "") {
    out.googleFlightsUrl = url;
  }
  const insights = readInsights(raw.price_insights);
  if (insights !== undefined) {
    out.priceInsights = insights;
  }
  if (offers.length === 0) {
    out.recommendation = "No return options for this departure_token — re-run offers_search and pick another outbound.";
  } else {
    out.recommendation = `${recommendOffers(out)} Next: call booking_options_get with booking_token from the chosen return offer.`;
  }
  const usage = await usageOrNil(client);
  if (usage !== undefined) {
    out.usage = usage;
  }
  return out;
}

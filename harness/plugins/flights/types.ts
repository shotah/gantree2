export type FlightSegment = {
  airline?: string;
  flightNumber?: string;
  airplane?: string;
  travelClass?: string;
  departureId?: string;
  arrivalId?: string;
  departureTime?: string;
  arrivalTime?: string;
  durationMin?: number;
};

export type CarbonInfo = {
  thisFlight?: number;
  typicalForRoute?: number;
  differencePercent?: number;
};

export type FlightOffer = {
  price: number;
  currency?: string;
  totalDurationMin?: number;
  stops: number;
  airlines?: string[];
  marketingCodes?: string[];
  departureAirport?: string;
  arrivalAirport?: string;
  departureTime?: string;
  arrivalTime?: string;
  layovers?: string[];
  flights?: FlightSegment[];
  carbon?: CarbonInfo;
  summary?: string;
  departureToken?: string;
  bookingToken?: string;
  flyAmericaStatus?: string;
  flyAmericaNote?: string;
};

export type PriceHistoryPoint = {
  timestamp: number;
  price: number;
};

export type PriceInsights = {
  lowestPrice?: number;
  priceLevel?: string;
  typicalPriceLow?: number;
  typicalPriceHigh?: number;
  priceHistory?: PriceHistoryPoint[];
};

export type Usage = {
  searchesUsed: number;
  searchesLeft: number;
  searchesPerMonth: number;
  planRenewalDate?: string;
  planName?: string;
};

export type OfferSearchResult = {
  tripType: string;
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate?: string;
  currency: string;
  googleFlightsUrl?: string;
  priceInsights?: PriceInsights;
  offers: FlightOffer[];
  recommendation?: string;
  complianceNote?: string;
  openSkiesHint?: string;
  usage?: Usage;
};

export type DatePrice = {
  outboundDate: string;
  returnDate?: string;
  lowestPrice?: number;
  currency?: string;
  airline?: string;
  stops: number;
  durationMin?: number;
  summary?: string;
  error?: string;
};

export type DatesSearchResult = {
  tripType: string;
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  stayNights?: number;
  currency: string;
  samples: DatePrice[];
  cheapestDate?: string;
  cheapestReturn?: string;
  cheapestPrice?: number;
  recommendation?: string;
  usage?: Usage;
};

export type AirportBrief = {
  name: string;
  id: string;
  city?: string;
  distance?: string;
};

export type AirportHit = {
  name: string;
  type?: string;
  id?: string;
  description?: string;
  airports?: AirportBrief[];
};

export type AirportsSearchResult = {
  query: string;
  suggestions: AirportHit[];
  usage?: Usage;
};

export type BookingRequest = {
  url: string;
  postData?: string;
  method: string;
  note?: string;
};

export type BookingOption = {
  bookWith?: string;
  optionTitle?: string;
  price?: number;
  currency?: string;
  marketedAs?: string[];
  extensions?: string[];
  baggagePrices?: string[];
  isAirline?: boolean;
  ticketMode?: string;
  refundable?: string;
  booking?: BookingRequest;
  summary?: string;
};

export type BookingOptionsResult = {
  options: BookingOption[];
  baggagePrices?: string[];
  recommendation?: string;
  checkoutNote: string;
  usage?: Usage;
};

export type LinkParams = {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate?: string;
  currency?: string;
  country?: string;
  language?: string;
};

export type OfferSearchRequest = {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate?: string;
  adults?: number;
  travelClass?: string;
  stops?: string;
  sortBy?: string;
  currency?: string;
  country?: string;
  language?: string;
  maxPrice?: number;
  deepSearch?: boolean;
  maxResults?: number;
  includeAirlines?: string;
  excludeAirlines?: string;
  excludeBasic?: boolean;
  flyAmerica?: string;
  funding?: string;
};

export type DatesSearchRequest = {
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  stayNights?: number;
  stayNightsMin?: number;
  stayNightsMax?: number;
  currency?: string;
  stops?: string;
  travelClass?: string;
  maxSamples?: number;
  includeAirlines?: string;
  excludeAirlines?: string;
};

function put(out: Record<string, unknown>, key: string, value: unknown, keepZero = false): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value === "string" && value === "") {
    return;
  }
  if (typeof value === "number" && value === 0 && !keepZero) {
    return;
  }
  if (typeof value === "boolean" && value === false) {
    return;
  }
  if (Array.isArray(value) && value.length === 0) {
    return;
  }
  out[key] = value;
}

export function usageJSON(usage: Usage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    searches_used: usage.searchesUsed,
    searches_left: usage.searchesLeft,
    searches_per_month: usage.searchesPerMonth,
  };
  put(out, "plan_renewal_date", usage.planRenewalDate);
  put(out, "plan_name", usage.planName);
  return out;
}

function segmentJSON(seg: FlightSegment): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "airline", seg.airline);
  put(out, "flight_number", seg.flightNumber);
  put(out, "airplane", seg.airplane);
  put(out, "travel_class", seg.travelClass);
  put(out, "departure_airport", seg.departureId);
  put(out, "arrival_airport", seg.arrivalId);
  put(out, "departure_time", seg.departureTime);
  put(out, "arrival_time", seg.arrivalTime);
  put(out, "duration_min", seg.durationMin);
  return out;
}

function carbonJSON(carbon: CarbonInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "this_flight", carbon.thisFlight);
  put(out, "typical_for_route", carbon.typicalForRoute);
  put(out, "difference_percent", carbon.differencePercent);
  return out;
}

export function offerJSON(offer: FlightOffer): Record<string, unknown> {
  const out: Record<string, unknown> = { price: offer.price };
  put(out, "currency", offer.currency);
  put(out, "total_duration_min", offer.totalDurationMin);
  out.stops = offer.stops;
  put(out, "airlines", offer.airlines);
  put(out, "marketing_codes", offer.marketingCodes);
  put(out, "departure_airport", offer.departureAirport);
  put(out, "arrival_airport", offer.arrivalAirport);
  put(out, "departure_time", offer.departureTime);
  put(out, "arrival_time", offer.arrivalTime);
  put(out, "layovers", offer.layovers);
  put(out, "flights", (offer.flights ?? []).map(segmentJSON));
  if (offer.carbon !== undefined) {
    out.carbon_emissions = carbonJSON(offer.carbon);
  }
  put(out, "summary", offer.summary);
  put(out, "departure_token", offer.departureToken);
  put(out, "booking_token", offer.bookingToken);
  put(out, "fly_america_status", offer.flyAmericaStatus);
  put(out, "fly_america_note", offer.flyAmericaNote);
  return out;
}

function insightsJSON(pi: PriceInsights): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "lowest_price", pi.lowestPrice);
  put(out, "price_level", pi.priceLevel);
  put(out, "typical_price_low", pi.typicalPriceLow);
  put(out, "typical_price_high", pi.typicalPriceHigh);
  if (pi.priceHistory !== undefined && pi.priceHistory.length > 0) {
    out.price_history = pi.priceHistory.map((point) => ({ timestamp: point.timestamp, price: point.price }));
  }
  return out;
}

export function offerResultJSON(res: OfferSearchResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    trip_type: res.tripType,
    origin: res.origin,
    destination: res.destination,
    outbound_date: res.outboundDate,
  };
  put(out, "return_date", res.returnDate);
  out.currency = res.currency;
  put(out, "google_flights_url", res.googleFlightsUrl);
  if (res.priceInsights !== undefined) {
    out.price_insights = insightsJSON(res.priceInsights);
  }
  out.offers = res.offers.map(offerJSON);
  put(out, "recommendation", res.recommendation);
  put(out, "compliance_note", res.complianceNote);
  put(out, "open_skies_hint", res.openSkiesHint);
  if (res.usage !== undefined) {
    out.usage = usageJSON(res.usage);
  }
  return out;
}

export function datePriceJSON(sample: DatePrice): Record<string, unknown> {
  const out: Record<string, unknown> = { outbound_date: sample.outboundDate };
  put(out, "return_date", sample.returnDate);
  put(out, "lowest_price", sample.lowestPrice);
  put(out, "currency", sample.currency);
  put(out, "airline", sample.airline);
  out.stops = sample.stops;
  put(out, "duration_min", sample.durationMin);
  put(out, "summary", sample.summary);
  put(out, "error", sample.error);
  return out;
}

export function datesResultJSON(res: DatesSearchResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    trip_type: res.tripType,
    origin: res.origin,
    destination: res.destination,
    start_date: res.startDate,
    end_date: res.endDate,
  };
  put(out, "stay_nights", res.stayNights);
  out.currency = res.currency;
  out.samples = res.samples.map(datePriceJSON);
  put(out, "cheapest_date", res.cheapestDate);
  put(out, "cheapest_return", res.cheapestReturn);
  put(out, "cheapest_price", res.cheapestPrice);
  put(out, "recommendation", res.recommendation);
  if (res.usage !== undefined) {
    out.usage = usageJSON(res.usage);
  }
  return out;
}

export function airportsResultJSON(res: AirportsSearchResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    query: res.query,
    suggestions: res.suggestions.map((hit) => {
      const item: Record<string, unknown> = { name: hit.name };
      put(item, "type", hit.type);
      put(item, "id", hit.id);
      put(item, "description", hit.description);
      if (hit.airports !== undefined && hit.airports.length > 0) {
        item.airports = hit.airports.map((airport) => {
          const brief: Record<string, unknown> = { name: airport.name, id: airport.id };
          put(brief, "city", airport.city);
          put(brief, "distance", airport.distance);
          return brief;
        });
      }
      return item;
    }),
  };
  if (res.usage !== undefined) {
    out.usage = usageJSON(res.usage);
  }
  return out;
}

export function bookingOptionJSON(option: BookingOption): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "book_with", option.bookWith);
  put(out, "option_title", option.optionTitle);
  put(out, "price", option.price);
  put(out, "currency", option.currency);
  put(out, "marketed_as", option.marketedAs);
  put(out, "extensions", option.extensions);
  put(out, "baggage_prices", option.baggagePrices);
  put(out, "is_airline", option.isAirline);
  put(out, "ticket_mode", option.ticketMode);
  put(out, "refundable", option.refundable);
  if (option.booking !== undefined) {
    const booking: Record<string, unknown> = { url: option.booking.url };
    put(booking, "post_data", option.booking.postData);
    booking.method = option.booking.method;
    put(booking, "note", option.booking.note);
    out.booking = booking;
  }
  put(out, "summary", option.summary);
  return out;
}

export function bookingResultJSON(res: BookingOptionsResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    options: res.options.map(bookingOptionJSON),
  };
  put(out, "baggage_prices", res.baggagePrices);
  put(out, "recommendation", res.recommendation);
  out.checkout_note = res.checkoutNote;
  if (res.usage !== undefined) {
    out.usage = usageJSON(res.usage);
  }
  return out;
}

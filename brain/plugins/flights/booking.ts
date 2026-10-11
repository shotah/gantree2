import { getJSON, usageOrNil, type SerpClient } from "./client";
import { detectRefundable, RefundableNo, RefundableYes } from "./filters";
import type { BookingOption, BookingOptionsResult } from "./types";
import { asArray, asRecord, num, round0, str } from "./wire";

const CHECKOUT_NOTE = "When booking.post_data is set, open booking.url with HTTP POST and send post_data unchanged as the body. "
  + "When post_data is empty, GET booking.url. This MCP does not purchase tickets. "
  + "refundable is parsed from Google option text only (yes/no/unknown) — never invent refundability.";

export type BookingOptionsRequest = {
  bookingToken: string;
  currency?: string;
  country?: string;
  language?: string;
  refundableOnly?: boolean;
};

function summarizeBookingOption(option: BookingOption): string {
  const title = option.optionTitle === undefined || option.optionTitle === "" ? "fare" : option.optionTitle;
  const parts = [
    `${round0(option.price ?? 0)} ${option.currency ?? ""}`,
    option.bookWith ?? "",
    title,
  ];
  if (option.refundable === RefundableYes) {
    parts.push("refundable");
  } else if (option.refundable === RefundableNo) {
    parts.push("non-refundable");
  }
  if (option.booking !== undefined) {
    parts.push(`${option.booking.method} checkout`);
  }
  return parts.join(" · ");
}

function normalizeBookingOption(raw: Record<string, unknown>, mode: string, currency: string): BookingOption {
  const extensions = asArray(raw.extensions).map((item) => str(item)).filter((item) => item !== "");
  const marketed = asArray(raw.marketed_as).map((item) => str(item)).filter((item) => item !== "");
  const baggage = asArray(raw.baggage_prices).map((item) => str(item)).filter((item) => item !== "");
  const option: BookingOption = {
    refundable: detectRefundable(str(raw.option_title), extensions),
    ticketMode: mode,
  };
  const bookWith = str(raw.book_with);
  const title = str(raw.option_title);
  if (bookWith !== "") {
    option.bookWith = bookWith;
  }
  if (title !== "") {
    option.optionTitle = title;
  }
  const price = num(raw.price);
  if (price !== 0) {
    option.price = price;
  }
  if (currency !== "") {
    option.currency = currency;
  }
  if (marketed.length > 0) {
    option.marketedAs = marketed;
  }
  if (extensions.length > 0) {
    option.extensions = extensions;
  }
  if (baggage.length > 0) {
    option.baggagePrices = baggage;
  }
  if (raw.airline === true) {
    option.isAirline = true;
  }
  const local = asArray(raw.local_prices);
  const firstLocal = asRecord(local[0]);
  const localCurrency = str(firstLocal.currency);
  if (local.length > 0 && localCurrency !== "") {
    option.currency = localCurrency;
    const localPrice = num(firstLocal.price);
    if (localPrice > 0) {
      option.price = localPrice;
    }
  }
  const booking = asRecord(raw.booking_request);
  const url = str(booking.url);
  if (isPresent(raw.booking_request) && url !== "") {
    const post = str(booking.post_data);
    if (post.trim() !== "") {
      option.booking = {
        url,
        postData: post,
        method: "POST",
        note: "POST booking.url with body = booking.post_data exactly (do not modify).",
      };
    } else {
      option.booking = {
        url,
        method: "GET",
        note: "Open booking.url in the browser (GET).",
      };
    }
  }
  option.summary = summarizeBookingOption(option);
  return option;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function recommendBookingOptions(options: BookingOption[]): string {
  if (options.length === 0) {
    return "No checkout options.";
  }
  let best = options[0];
  let bestIdx = 0;
  if (best === undefined) {
    return "No checkout options.";
  }
  for (let i = 1; i < options.length; i += 1) {
    const option = options[i];
    if (option === undefined) {
      continue;
    }
    const price = option.price ?? 0;
    const bestPrice = best.price ?? 0;
    if (price > 0 && (bestPrice === 0 || price < bestPrice)) {
      best = option;
      bestIdx = i;
    }
  }
  let pick = best;
  let pickIdx = bestIdx;
  const bestPrice = best.price ?? 0;
  for (let i = 0; i < options.length; i += 1) {
    const option = options[i];
    if (option === undefined) {
      continue;
    }
    const price = option.price ?? 0;
    if (option.refundable !== RefundableYes || price <= 0) {
      continue;
    }
    const pickPrice = pick.price ?? 0;
    if (price <= bestPrice * 1.2 && (pick.refundable !== RefundableYes || price < pickPrice)) {
      pick = option;
      pickIdx = i;
    }
  }
  let msg = `Cheapest checkout option #${String(bestIdx + 1)}: ${best.summary ?? ""}.`;
  if (pickIdx !== bestIdx) {
    msg = `Prefer refundable option #${String(pickIdx + 1)}: ${pick.summary ?? ""}. (cheapest is #${String(bestIdx + 1)} at ${round0(bestPrice)} ${best.currency ?? ""})`;
  }
  if (pick.booking !== undefined || best.booking !== undefined) {
    msg += " Use options[].booking for the real buy handoff (not google_flights_url).";
  }
  return msg;
}

export async function getBookingOptions(client: SerpClient, req: BookingOptionsRequest): Promise<BookingOptionsResult> {
  const bookingToken = req.bookingToken.trim();
  if (bookingToken === "") {
    throw new Error("booking_token is required (from offers_search or returns_search)");
  }
  let currency = req.currency === undefined || req.currency === "" ? "USD" : req.currency;
  const country = req.country === undefined || req.country === "" ? "us" : req.country;
  const language = req.language === undefined || req.language === "" ? "en" : req.language;
  const raw = asRecord(await getJSON(client, "/search.json", {
    engine: "google_flights",
    booking_token: bookingToken,
    currency,
    gl: country,
    hl: language,
  }));
  const apiError = str(raw.error);
  if (apiError !== "") {
    throw new Error(`serpapi: ${apiError}`);
  }
  const searchCurrency = str(asRecord(raw.search_parameters).currency);
  if (searchCurrency !== "") {
    currency = searchCurrency;
  }
  const options: BookingOption[] = [];
  for (const item of asArray(raw.booking_options)) {
    const wrap = asRecord(item);
    if (isPresent(wrap.together)) {
      options.push(normalizeBookingOption(asRecord(wrap.together), "together", currency));
    }
    if (isPresent(wrap.departing)) {
      options.push(normalizeBookingOption(asRecord(wrap.departing), "departing", currency));
    }
    if (isPresent(wrap.returning)) {
      options.push(normalizeBookingOption(asRecord(wrap.returning), "returning", currency));
    }
  }
  if (options.length === 0) {
    throw new Error("no booking options returned — token may be expired; re-run offers_search");
  }
  const filtered = req.refundableOnly === true ? options.filter((option) => option.refundable !== RefundableNo) : options;
  if (filtered.length === 0) {
    throw new Error("no booking options left after refundable_only — Google only showed non-refundable fares, or refundability was not labeled");
  }
  const baggageRaw = asRecord(raw.baggage_prices);
  const together = asArray(baggageRaw.together).map((item) => str(item)).filter((item) => item !== "");
  const out: BookingOptionsResult = {
    options: filtered,
    checkoutNote: CHECKOUT_NOTE,
    recommendation: recommendBookingOptions(filtered),
  };
  if (together.length > 0) {
    out.baggagePrices = together;
  }
  const usage = await usageOrNil(client);
  if (usage !== undefined) {
    out.usage = usage;
  }
  return out;
}

import { encodeQuery } from "./wire";
import type { LinkParams } from "./types";

export function buildGoogleFlightsURL(params: LinkParams): string {
  const origin = params.origin.trim().toUpperCase();
  const destination = params.destination.trim().toUpperCase();
  const outbound = params.outboundDate.trim();
  const ret = params.returnDate?.trim() ?? "";
  const language = params.language === undefined || params.language === "" ? "en" : params.language;
  const country = params.country === undefined || params.country === "" ? "us" : params.country;
  const currency = params.currency === undefined || params.currency === "" ? "USD" : params.currency;
  let query = `Flights from ${origin} to ${destination} on ${outbound}`;
  if (ret !== "") {
    query += ` through ${ret}`;
  }
  const encoded = encodeQuery({
    hl: language,
    gl: country,
    curr: currency,
    q: query,
  });
  return `https://www.google.com/travel/flights?${encoded}`;
}

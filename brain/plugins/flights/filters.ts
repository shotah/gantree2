import type { FlightOffer, FlightSegment, OfferSearchResult } from "./types";

const airlinePresets: Record<string, string> = {
  alaska_partners: "AS,ONEWORLD",
  alaska: "AS,ONEWORLD",
  delta_partners: "DL,SKYTEAM",
  delta: "DL,SKYTEAM",
};

const knownAlliances = new Set(["STAR_ALLIANCE", "SKYTEAM", "ONEWORLD"]);

const usFlagCarriers = new Set([
  "AA", "AS", "B6", "DL", "F9", "G4",
  "HA", "MX", "NK", "SY", "UA", "WN",
  "YX", "OO", "QX", "CP", "9E", "OH",
  "MQ", "PT", "ZW", "C5", "G7",
]);

const airlineNameToIATA: Record<string, string> = {
  "alaska airlines": "AS",
  alaska: "AS",
  "american airlines": "AA",
  american: "AA",
  "delta air lines": "DL",
  delta: "DL",
  "united airlines": "UA",
  united: "UA",
  jetblue: "B6",
  "jetblue airways": "B6",
  "southwest airlines": "WN",
  southwest: "WN",
  "hawaiian airlines": "HA",
  hawaiian: "HA",
  "frontier airlines": "F9",
  frontier: "F9",
  "spirit airlines": "NK",
  spirit: "NK",
  "allegiant air": "G4",
  allegiant: "G4",
  "sun country airlines": "SY",
  "sun country": "SY",
  "breeze airways": "MX",
  breeze: "MX",
  "british airways": "BA",
  "air france": "AF",
  klm: "KL",
  lufthansa: "LH",
  ana: "NH",
  "all nippon airways": "NH",
  "japan airlines": "JL",
  jal: "JL",
  "eva air": "BR",
  "china airlines": "CI",
  "korean air": "KE",
  "qatar airways": "QR",
  emirates: "EK",
  "singapore airlines": "SQ",
  "cathay pacific": "CX",
  "air canada": "AC",
  westjet: "WS",
};

const openSkiesAirports: Record<string, string> = {
  HND: "JP", NRT: "JP", KIX: "JP", ITM: "JP", FUK: "JP", NGO: "JP",
  SYD: "AU", MEL: "AU", BNE: "AU", PER: "AU", ADL: "AU", CBR: "AU",
  ZRH: "CH", GVA: "CH", BSL: "CH",
  CDG: "EU", ORY: "EU", LYS: "EU", NCE: "EU", MRS: "EU",
  FRA: "EU", MUC: "EU", BER: "EU", DUS: "EU", HAM: "EU",
  AMS: "EU", BRU: "EU", LUX: "EU",
  MAD: "EU", BCN: "EU", LIS: "EU", OPO: "EU",
  FCO: "EU", MXP: "EU", LIN: "EU", VCE: "EU",
  ATH: "EU", VIE: "EU", PRG: "EU", BUD: "EU", WAW: "EU",
  CPH: "EU", ARN: "EU", OSL: "EU", HEL: "EU",
  DUB: "EU", KEF: "EU",
  LHR: "EU", LGW: "EU", STN: "EU", MAN: "EU", EDI: "EU",
};

export const FlyAmericaOK = "likely_fly_america_ok";
export const FlyAmericaReview = "needs_review";
export const FlyAmericaForeign = "likely_foreign";

export const RefundableYes = "yes";
export const RefundableNo = "no";
export const RefundableUnknown = "unknown";

function isUpper(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isLetter(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
}

export function resolveAirlineList(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of trimmed.split(",")) {
    const tok = part.trim();
    if (tok === "") {
      continue;
    }
    const preset = airlinePresets[tok.toLowerCase()];
    if (preset !== undefined) {
      for (const entry of preset.split(",")) {
        const code = entry.trim();
        if (code === "" || seen.has(code)) {
          continue;
        }
        seen.add(code);
        out.push(code);
      }
      continue;
    }
    const up = tok.toUpperCase();
    if (knownAlliances.has(up)) {
      if (!seen.has(up)) {
        seen.add(up);
        out.push(up);
      }
      continue;
    }
    if (!validAirlineIATA(up)) {
      throw new Error(`invalid airline code ${JSON.stringify(tok)} (use 2-char IATA, STAR_ALLIANCE/SKYTEAM/ONEWORLD, or alaska_partners/delta_partners)`);
    }
    if (!seen.has(up)) {
      seen.add(up);
      out.push(up);
    }
  }
  return out.join(",");
}

export function validAirlineIATA(code: string): boolean {
  if (code.length !== 2) {
    return false;
  }
  let hasLetter = false;
  for (const ch of code) {
    if (isUpper(ch) || isDigit(ch)) {
      if (isUpper(ch)) {
        hasLetter = true;
      }
      continue;
    }
    return false;
  }
  return hasLetter;
}

export function applyAirlineParams(include: string, exclude: string): { inc: string; exc: string } {
  const inc = resolveAirlineList(include);
  const exc = resolveAirlineList(exclude);
  if (inc !== "" && exc !== "") {
    throw new Error("include_airlines and exclude_airlines cannot be used together");
  }
  return { inc, exc };
}

export function marketingCodeFromFlightNumber(fn: string): string {
  const upper = fn.trim().toUpperCase();
  if (upper === "") {
    return "";
  }
  let code = "";
  for (let i = 0; i < upper.length; i += 1) {
    const ch = upper[i] ?? "";
    if (isLetter(ch) || isDigit(ch)) {
      code += ch;
      if (code.length === 2) {
        const rest = upper.slice(i + 1).trim();
        if (rest === "") {
          return "";
        }
        for (const rr of rest) {
          if (isDigit(rr)) {
            return code;
          }
          if (rr === " " || rr === "\t") {
            continue;
          }
          break;
        }
        return "";
      }
      continue;
    }
    if ((ch === " " || ch === "\t") && code.length > 0) {
      continue;
    }
    break;
  }
  return "";
}

export function marketingCodeFromAirlineName(name: string): string {
  const key = name.trim().toLowerCase();
  if (key === "") {
    return "";
  }
  return airlineNameToIATA[key] ?? "";
}

export function segmentMarketingCode(seg: FlightSegment): string {
  const fromNumber = marketingCodeFromFlightNumber(seg.flightNumber ?? "");
  if (fromNumber !== "") {
    return fromNumber;
  }
  return marketingCodeFromAirlineName(seg.airline ?? "");
}

export function classifyFlyAmerica(offer: FlightOffer): { status: string; note: string; codes: string[] } {
  const seen = new Set<string>();
  const codes: string[] = [];
  let us = 0;
  let foreign = 0;
  let unknown = 0;
  for (const seg of offer.flights ?? []) {
    const code = segmentMarketingCode(seg);
    if (code === "") {
      unknown += 1;
      continue;
    }
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
    if (usFlagCarriers.has(code)) {
      us += 1;
    } else {
      foreign += 1;
    }
  }
  let note = "Based on marketing flight designators only (codeshare metal may differ). "
    + "Not legal certification — confirm the ticket shows a US carrier designator when required.";
  const flights = offer.flights ?? [];
  if (flights.length === 0 || (us === 0 && foreign === 0)) {
    return { status: FlyAmericaReview, note: `${note} Could not determine marketing carriers.`, codes };
  }
  if (foreign === 0 && unknown === 0) {
    return { status: FlyAmericaOK, note, codes };
  }
  if (us === 0 && foreign > 0 && unknown === 0) {
    note = `${note} One or more segments appear ticketed under a foreign designator.`;
    return { status: FlyAmericaForeign, note, codes };
  }
  if (foreign > 0) {
    note = `${note} Mix includes a foreign marketing designator.`;
    return { status: FlyAmericaForeign, note, codes };
  }
  note = `${note} Incomplete marketing codes on some segments.`;
  return { status: FlyAmericaReview, note, codes };
}

export function applyFlyAmerica(out: OfferSearchResult, modeRaw: string, fundingRaw: string): void {
  const mode = modeRaw.trim().toLowerCase();
  let funding = fundingRaw.trim().toLowerCase();
  if (mode === "" || mode === "off" || mode === "none") {
    return;
  }
  if (mode !== "annotate" && mode !== "filter") {
    throw new Error("fly_america must be annotate, filter, or empty");
  }
  if (funding === "") {
    funding = "civilian";
  }
  if (funding !== "civilian" && funding !== "dod") {
    throw new Error("funding must be civilian or dod");
  }
  const kept: FlightOffer[] = [];
  for (const offer of out.offers) {
    const classified = classifyFlyAmerica(offer);
    const next: FlightOffer = {
      ...offer,
      flyAmericaStatus: classified.status,
      flyAmericaNote: classified.note,
      marketingCodes: classified.codes,
    };
    if (mode === "filter" && classified.status === FlyAmericaForeign) {
      continue;
    }
    kept.push(next);
  }
  out.offers = kept;
  out.complianceNote = `fly_america=${mode} is a heuristic hint only — not legal advice or certification. `
    + "Confirm the purchased ticket shows a US-flag carrier designator (or a documented exception).";
  const region = openSkiesAirports[out.destination.toUpperCase()];
  if (region !== undefined && funding === "civilian") {
    out.openSkiesHint = `Destination ${out.destination} looks like Open Skies region (${region}). Civilian-funded travel may have Open Skies exceptions; DoD-funded travel typically cannot use them. Verify current GSA/agency rules.`;
  } else if (funding === "dod") {
    out.openSkiesHint = "funding=dod: Open Skies exceptions typically do not apply — prefer US-flag marketing designators.";
  }
}

export function detectRefundable(title: string, extensions: string[]): string {
  const blob = `${title} ${extensions.join(" ")}`.trim().toLowerCase();
  if (blob === "") {
    return RefundableUnknown;
  }
  if (blob.includes("no refund") || blob.includes("non-refundable") || blob.includes("nonrefundable") || blob.includes("non refundable")) {
    return RefundableNo;
  }
  if (blob.includes("refundable") || blob.includes("full refund") || blob.includes("refunds allowed")) {
    return RefundableYes;
  }
  return RefundableUnknown;
}

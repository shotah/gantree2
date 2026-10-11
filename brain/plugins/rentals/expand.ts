import { lookupNeighborhood, parseZipList, type AreaPreset } from "@/brain/plugins/rentals/areas.ts";

export const amenityUnsupportedNote = "RentCast listings API does not expose pet/parking/laundry filters — verify with the listing agent/office.";

export type ListingsSearchRequest = {
  intent?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  zipCodes?: string;
  neighborhood?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  propertyType?: string;
  bedrooms?: string;
  bathrooms?: string;
  squareFootage?: string;
  priceMin?: number;
  priceMax?: number;
  status?: string;
  daysOld?: string;
  daysOldMax?: number;
  newThisWeek?: boolean;
  petsWanted?: boolean;
  parkingWanted?: boolean;
  laundryWanted?: boolean;
  limit?: number;
  offset?: number;
  zipFilter?: string[];
};

export function parseNeighborhoodList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return [];
  }
  const parts = trimmed.replaceAll("|", ",").replaceAll(";", ",").split(",");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.trim();
    if (name === "") {
      continue;
    }
    const key = name.toLowerCase().replaceAll("-", " ").replaceAll("_", " ").split(/\s+/).filter((piece) => piece !== "").join(" ");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name);
  }
  return out;
}

function mergeZips(base: string[], extra: string[]): string[] {
  if (base.length === 0) {
    return [...extra];
  }
  if (extra.length === 0) {
    return [...base];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const zip of [...base, ...extra]) {
    if (seen.has(zip)) {
      continue;
    }
    seen.add(zip);
    out.push(zip);
  }
  return out;
}

export function filterListingsByZips<T extends { zipCode?: string }>(listings: T[], zips: string[]): T[] {
  if (zips.length === 0) {
    return listings;
  }
  const allow = new Set(zips);
  return listings.filter((listing) => allow.has((listing.zipCode ?? "").trim()));
}

function applyOneNeighborhood(req: ListingsSearchRequest, name: string, zips: string[], notes: string[]): { req: ListingsSearchRequest; zips: string[]; notes: string[] } {
  const area: AreaPreset | null = lookupNeighborhood(name, req.city ?? "", req.state ?? "");
  if (area === null) {
    throw new Error(`unknown neighborhood ${JSON.stringify(name)} — call areas_resolve (list_all=true) for Seattle presets`);
  }
  req.neighborhood = area.name;
  if ((req.city ?? "").trim() === "") {
    req.city = area.city;
  }
  if ((req.state ?? "").trim() === "") {
    req.state = area.state;
  }
  zips = mergeZips(zips, area.zips);
  const explicitZips = parseZipList(req.zipCodes ?? "").length > 0;
  const useGeo = (area.latitude ?? 0) !== 0 && (area.longitude ?? 0) !== 0
    && (req.latitude ?? 0) === 0 && (req.longitude ?? 0) === 0
    && (req.zipCode ?? "").trim() === ""
    && !explicitZips;
  if (useGeo) {
    req.latitude = area.latitude;
    req.longitude = area.longitude;
    if ((req.radius ?? 0) <= 0) {
      req.radius = (area.radius ?? 0) > 0 ? area.radius : 1.5;
    }
    notes.push(`neighborhood ${area.name} → lat/lng + ${(req.radius ?? 0).toFixed(1)} mi radius (1 API call)`);
  } else if (area.zips.length === 1 && (req.zipCode ?? "").trim() === "") {
    const zip = area.zips[0] ?? "";
    req.zipCode = zip;
    notes.push(`neighborhood ${area.name} → zip ${zip} (1 API call)`);
  } else if (area.zips.length > 1) {
    notes.push(`neighborhood ${area.name} → filter zips ${area.zips.join(", ")} (1 API call)`);
  }
  return { req, zips, notes };
}

function applyNeighborhoods(req: ListingsSearchRequest, zips: string[], notes: string[]): { req: ListingsSearchRequest; zips: string[]; notes: string[] } {
  const names = parseNeighborhoodList(req.neighborhood ?? "");
  if (names.length === 0) {
    return { req, zips, notes };
  }
  const only = names[0];
  if (names.length === 1 && only !== undefined) {
    return applyOneNeighborhood(req, only, zips, notes);
  }
  const resolved: string[] = [];
  for (const name of names) {
    const area = lookupNeighborhood(name, req.city ?? "", req.state ?? "");
    if (area === null) {
      throw new Error(`unknown neighborhood ${JSON.stringify(name)} — call areas_resolve (list_all=true) for Seattle presets`);
    }
    resolved.push(area.name);
    if ((req.city ?? "").trim() === "") {
      req.city = area.city;
    }
    if ((req.state ?? "").trim() === "") {
      req.state = area.state;
    }
    zips = mergeZips(zips, area.zips);
  }
  req.neighborhood = resolved.join(", ");
  req.latitude = 0;
  req.longitude = 0;
  req.radius = 0;
  notes.push(`neighborhoods [${req.neighborhood}] → one search, filter zips ${zips.join(", ")}`);
  return { req, zips, notes };
}

export function expandListingsSearch(req: ListingsSearchRequest): { req: ListingsSearchRequest; notes: string[] } {
  const out: ListingsSearchRequest = { ...req };
  let notes: string[] = [];
  let zips = parseZipList(out.zipCodes ?? "");
  const single = (out.zipCode ?? "").trim();
  if (single !== "") {
    zips = mergeZips(zips, parseZipList(single));
  }
  const applied = applyNeighborhoods(out, zips, notes);
  zips = applied.zips;
  notes = applied.notes;
  if (zips.length === 1 && (applied.req.zipCode ?? "").trim() === "") {
    applied.req.zipCode = zips[0];
  } else if (zips.length > 1) {
    applied.req.zipCode = "";
    if ((applied.req.latitude ?? 0) !== 0 || (applied.req.longitude ?? 0) !== 0) {
      notes.push("thrifty: one geo API call, client filter to zip_filter");
    } else if ((applied.req.city ?? "").trim() !== "" && (applied.req.state ?? "").trim() !== "") {
      notes.push("thrifty: one city+state API call, client filter to zip_filter");
    } else if ((applied.req.address ?? "").trim() !== "") {
      notes.push("thrifty: one address/radius API call, client filter to zip_filter");
    } else {
      applied.req.zipCode = zips[0];
      notes.push(`thrifty: one API call via primary zip ${zips[0] ?? ""} (pass city+state to cover all zips once)`);
    }
  }
  applied.req.zipFilter = zips;
  if (applied.req.newThisWeek === true && (applied.req.daysOld ?? "").trim() === "" && (applied.req.daysOldMax ?? 0) <= 0) {
    applied.req.daysOldMax = 7;
    notes.push("new_this_week → days_old_max=7");
  }
  if ((applied.req.daysOldMax ?? 0) > 0 && (applied.req.daysOld ?? "").trim() === "") {
    applied.req.daysOld = String(applied.req.daysOldMax);
  }
  if (applied.req.petsWanted === true || applied.req.parkingWanted === true || applied.req.laundryWanted === true) {
    notes.push(amenityUnsupportedNote);
  }
  return { req: applied.req, notes };
}

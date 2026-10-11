export type AreaPreset = {
  name: string;
  city: string;
  state: string;
  zips: string[];
  latitude?: number;
  longitude?: number;
  radius?: number;
  aliases?: string[];
};

export type AreaResolveRequest = {
  neighborhood?: string;
  city?: string;
  state?: string;
  listAll?: boolean;
};

export type AreaResolveResult = {
  areas: AreaPreset[];
  count: number;
  note?: string;
};

const defaultNeighborhoodRadius = 1.5;

function sea(name: string, zips: string[], lat: number, lng: number, radius: number, aliases: string[] = []): AreaPreset {
  return { name, city: "Seattle", state: "WA", zips, latitude: lat, longitude: lng, radius, aliases };
}

const seattleNeighborhoods: AreaPreset[] = [
  sea("Capitol Hill", ["98102", "98122"], 47.6253, -122.3222, 1.5, ["cap hill", "capitolhill"]),
  sea("Ballard", ["98107", "98117"], 47.6687, -122.383, 1.5),
  sea("Fremont", ["98103"], 47.651, -122.349, 1.2),
  sea("Queen Anne", ["98109", "98119"], 47.637, -122.357, 1.5),
  sea("University District", ["98105"], 47.6625, -122.3132, 1.3, ["u district", "udistrict", "u-district"]),
  sea("Wallingford", ["98103"], 47.661, -122.333, 1.2),
  sea("Green Lake", ["98103", "98115"], 47.68, -122.328, 1.3),
  sea("Phinney Ridge", ["98103", "98117"], 47.675, -122.354, 1.2),
  sea("Greenwood", ["98103", "98117", "98133"], 47.69, -122.355, 1.5),
  sea("Magnolia", ["98199"], 47.65, -122.4, 1.8),
  sea("West Seattle", ["98116", "98126", "98136"], 47.566, -122.386, 2.5),
  sea("Beacon Hill", ["98108", "98118", "98144"], 47.562, -122.308, 2),
  sea("Columbia City", ["98118"], 47.558, -122.286, 1.3),
  sea("Central District", ["98122"], 47.606, -122.302, 1.5, ["cd", "central district seattle"]),
  sea("First Hill", ["98101", "98104", "98122"], 47.608, -122.323, 1),
  sea("Belltown", ["98121"], 47.614, -122.345, 0.8),
  sea("Downtown", ["98101", "98104", "98121"], 47.6062, -122.3321, 1.2, ["downtown seattle"]),
  sea("South Lake Union", ["98109"], 47.625, -122.336, 1, ["slu"]),
  sea("Madrona", ["98122"], 47.613, -122.29, 1),
  sea("Madison Park", ["98112"], 47.635, -122.28, 1.2),
  sea("Ravenna", ["98115"], 47.675, -122.302, 1.3),
  sea("Roosevelt", ["98115"], 47.677, -122.316, 1),
  sea("Northgate", ["98125"], 47.708, -122.325, 1.5),
  sea("Lake City", ["98125", "98155"], 47.719, -122.295, 1.5),
  sea("Mount Baker", ["98144"], 47.578, -122.288, 1.2),
  sea("Rainier Valley", ["98118", "98144"], 47.55, -122.28, 2),
  sea("Georgetown", ["98108"], 47.544, -122.327, 1.2),
  sea("International District", ["98104"], 47.598, -122.325, 0.8, ["id", "chinatown", "chinatown-international district"]),
  sea("Pioneer Square", ["98104"], 47.601, -122.333, 0.7),
  sea("Eastlake", ["98102"], 47.641, -122.325, 1),
];

export function normalizeAreaKey(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", " ").replaceAll("_", " ").split(/\s+/).filter((part) => part !== "").join(" ");
}

function copyArea(area: AreaPreset): AreaPreset {
  const out: AreaPreset = {
    ...area,
    zips: [...area.zips],
    aliases: area.aliases === undefined ? undefined : [...area.aliases],
  };
  if ((out.radius ?? 0) <= 0 && (out.latitude ?? 0) !== 0) {
    out.radius = defaultNeighborhoodRadius;
  }
  return out;
}

function areaMatches(area: AreaPreset, key: string): boolean {
  const name = normalizeAreaKey(area.name);
  if (name === key || name.includes(key)) {
    return true;
  }
  return (area.aliases ?? []).some((alias) => normalizeAreaKey(alias) === key);
}

export function resolveAreas(req: AreaResolveRequest): AreaResolveResult {
  const city = (req.city ?? "").trim();
  const state = (req.state ?? "").trim().toUpperCase();
  const neighborhood = normalizeAreaKey(req.neighborhood ?? "");
  const matches: AreaPreset[] = [];
  for (const area of seattleNeighborhoods) {
    if (city !== "" && area.city.toLowerCase() !== city.toLowerCase()) {
      continue;
    }
    if (state !== "" && area.state.toLowerCase() !== state.toLowerCase()) {
      continue;
    }
    if (req.listAll === true || neighborhood === "") {
      matches.push(copyArea(area));
      continue;
    }
    if (areaMatches(area, neighborhood)) {
      matches.push(copyArea(area));
    }
  }
  matches.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (neighborhood !== "" && req.listAll !== true && matches.length === 0) {
    let hint = "Try areas_resolve with list_all=true";
    if (city === "" && state === "") {
      hint += " (Seattle WA presets are built in)";
    }
    throw new Error(`unknown neighborhood ${JSON.stringify(req.neighborhood ?? "")} — ${hint}`);
  }
  let note = "Local presets only (no API). Use returned zips / lat/lng with listings_search. Seattle is the first metro; more cities can be added later.";
  const only = matches[0];
  if (neighborhood !== "" && matches.length === 1 && only !== undefined) {
    note = `Resolved ${only.name} → zips ${only.zips.join(", ")}. Prefer listings_search with neighborhood=${JSON.stringify(only.name)} (one API call via lat/lng).`;
  }
  return { areas: matches, count: matches.length, note };
}

export function lookupNeighborhood(name: string, city: string, state: string): AreaPreset | null {
  let res: AreaResolveResult;
  try {
    res = resolveAreas({ neighborhood: name, city, state });
  } catch {
    return null;
  }
  if (res.areas.length === 0) {
    return null;
  }
  const key = normalizeAreaKey(name);
  for (const area of res.areas) {
    if (normalizeAreaKey(area.name) === key) {
      return area;
    }
  }
  return res.areas[0] ?? null;
}

export function areaJSON(area: AreaPreset): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: area.name,
    city: area.city,
    state: area.state,
    zips: area.zips,
  };
  if ((area.latitude ?? 0) !== 0) {
    out["latitude"] = area.latitude;
  }
  if ((area.longitude ?? 0) !== 0) {
    out["longitude"] = area.longitude;
  }
  if ((area.radius ?? 0) !== 0) {
    out["radius_miles"] = area.radius;
  }
  if (area.aliases !== undefined && area.aliases.length > 0) {
    out["aliases"] = area.aliases;
  }
  return out;
}

export function parseZipList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return [];
  }
  const parts = trimmed.replaceAll("|", ",").replaceAll(";", ",").split(/[,\s]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let part of parts) {
    part = part.trim();
    if (part.length < 5) {
      continue;
    }
    if (part.length > 5 && part[5] === "-") {
      part = part.slice(0, 5);
    }
    if (part.length !== 5 || seen.has(part)) {
      continue;
    }
    seen.add(part);
    out.push(part);
  }
  return out;
}

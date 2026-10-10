import type { Geo, PhoneContext } from "../chat/frame";

export type GeoFix = {
  lat: number;
  lon: number;
  accuracy_m?: number;
  alt_m?: number;
  heading?: number;
  speed_mps?: number;
};

/** GPS first. Omit unused keys — the harness only reads `geo` → here. */
export function buildContext(opts: {
  now?: Date;
  timeZone?: string;
  geo?: GeoFix | null;
  battery?: { pct: number; charging: boolean } | null;
  net?: PhoneContext["net"];
  surface?: PhoneContext["surface"];
  input?: PhoneContext["input"];
}): PhoneContext {
  const ctx: PhoneContext = {};
  if (opts.now) {
    ctx.at = opts.now.toISOString();
  }
  if (opts.timeZone) {
    ctx.tz = opts.timeZone;
  }
  if (opts.geo) {
    ctx.geo = opts.geo;
  }
  if (opts.battery) {
    ctx.battery = opts.battery;
  }
  if (opts.net) {
    ctx.net = opts.net;
  }
  if (opts.surface) {
    ctx.surface = opts.surface;
  }
  if (opts.input) {
    ctx.input = opts.input;
  }
  return ctx;
}

/** Drop `{}` so a mouth that stamps nothing does not store an empty context blob. */
export function wireContext(ctx: PhoneContext): PhoneContext | undefined {
  if (ctx.geo || ctx.battery || ctx.net || ctx.at || ctx.tz || ctx.surface || ctx.input) {
    return ctx;
  }
  return undefined;
}

export function geoFromPosition(pos: {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
}): GeoFix {
  const c = pos.coords;
  const geo: GeoFix = { lat: c.latitude, lon: c.longitude };
  if (typeof c.accuracy === "number" && Number.isFinite(c.accuracy)) {
    geo.accuracy_m = c.accuracy;
  }
  if (typeof c.altitude === "number" && Number.isFinite(c.altitude)) {
    geo.alt_m = c.altitude;
  }
  if (typeof c.heading === "number" && Number.isFinite(c.heading) && c.heading >= 0) {
    geo.heading = c.heading;
  }
  if (typeof c.speed === "number" && Number.isFinite(c.speed) && c.speed >= 0) {
    geo.speed_mps = c.speed;
  }
  return geo;
}

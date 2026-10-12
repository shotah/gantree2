/**
 * Unit conversion. Factors match the go-units values the math server tests
 * (mile, pound, °F, imperial gallon, US fluid gallon). Bare gallon/gal is
 * imperial; us_gallon is US liquid.
 */

export type Converted = {
  value: number;
  from: string;
  to: string;
  label: string;
};

type Dim = "length" | "mass" | "volume" | "time" | "speed" | "area" | "temp";

type Unit = {
  name: string;
  symbol: string;
  dim: Dim;
  factor: number;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
};

const US_FLUID_GALLON = "fluid gallon";

const ALIASES: Record<string, string> = {
  us_gallon: US_FLUID_GALLON,
  "us-gallon": US_FLUID_GALLON,
  "us gallon": US_FLUID_GALLON,
  us_gal: US_FLUID_GALLON,
  "us-gal": US_FLUID_GALLON,
  usgal: US_FLUID_GALLON,
  "liquid gallon": US_FLUID_GALLON,
  liquid_gallon: US_FLUID_GALLON,
};

const byKey = new Map<string, Unit>();

function linear(name: string, symbol: string, dim: Dim, factor: number, extra: string[] = []): void {
  const unit: Unit = {
    name,
    symbol,
    dim,
    factor,
    toBase: (v) => v * factor,
    fromBase: (v) => v / factor,
  };
  for (const key of [name, symbol, ...extra]) {
    const k = key.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, unit);
  }
}

function temp(name: string, symbol: string, toBase: (v: number) => number, fromBase: (v: number) => number): void {
  const unit: Unit = { name, symbol, dim: "temp", factor: 1, toBase, fromBase };
  for (const key of [name, symbol]) {
    const k = key.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, unit);
  }
}

linear("meter", "m", "length", 1);
linear("kilometer", "km", "length", 1000);
linear("centimeter", "cm", "length", 0.01);
linear("millimeter", "mm", "length", 0.001);
linear("micrometer", "um", "length", 1e-6, ["µm"]);
linear("inch", "in", "length", 0.0254);
linear("foot", "ft", "length", 0.3048);
linear("yard", "yd", "length", 0.9144);
linear("mile", "mi", "length", 1609.344);
linear("nautical mile", "nmi", "length", 1852);

linear("kilogram", "kg", "mass", 1);
linear("gram", "g", "mass", 0.001);
linear("milligram", "mg", "mass", 1e-6);
linear("pound", "lb", "mass", 0.45359237);
linear("ounce", "oz", "mass", 0.028349523125);

linear("liter", "l", "volume", 1, ["litre", "L"]);
linear("milliliter", "ml", "volume", 0.001, ["mL"]);
linear("cubic meter", "m3", "volume", 1000, ["m^3"]);
linear("gallon", "gal", "volume", 4.54609);
linear(US_FLUID_GALLON, "fl gal", "volume", 3.785411784);

linear("second", "s", "time", 1, ["sec"]);
linear("minute", "min", "time", 60);
linear("hour", "h", "time", 3600, ["hr"]);
linear("day", "day", "time", 86400);

linear("meter per second", "m/s", "speed", 1);
linear("kilometer per hour", "km/h", "speed", 1 / 3.6, ["kph"]);
linear("mile per hour", "mph", "speed", 0.44704);

linear("square meter", "m2", "area", 1, ["m^2"]);
linear("hectare", "ha", "area", 10000);
linear("acre", "acre", "area", 4046.8564224);
linear("square foot", "ft2", "area", 0.09290304, ["sqft"]);

temp("kelvin", "K", (v) => v, (v) => v);
temp("celsius", "C", (v) => v + 273.15, (v) => v - 273.15);
temp("fahrenheit", "F", (v) => (v + 459.67) * 5 / 9, (v) => v * 9 / 5 - 459.67);

export function resolveUnit(name: string): string {
  const s = name.trim();
  if (!s) return "";
  return ALIASES[s.toLowerCase()] ?? s;
}

export function convert(value: number, fromRaw: string, toRaw: string): Converted {
  const from = resolveUnit(fromRaw);
  const to = resolveUnit(toRaw);
  if (!from || !to) throw new Error("from and to units are required");
  if (!Number.isFinite(value)) throw new Error("value must be a finite number");
  const fromUnit = byKey.get(from.toLowerCase());
  if (!fromUnit) throw new Error(`unknown from unit ${JSON.stringify(from)}: unit not found`);
  const toUnit = byKey.get(to.toLowerCase());
  if (!toUnit) throw new Error(`unknown to unit ${JSON.stringify(to)}: unit not found`);
  if (fromUnit.dim !== toUnit.dim) {
    throw new Error(`cannot convert ${fromUnit.name} → ${toUnit.name}: incompatible units`);
  }
  const out = toUnit.fromBase(fromUnit.toBase(value));
  if (!Number.isFinite(out)) throw new Error("converted result is not finite");
  return {
    value: out,
    from: fromUnit.name,
    to: toUnit.name,
    label: `${trimFixed(out, 6)} ${toUnit.symbol}`,
  };
}

function trimFixed(n: number, prec: number): string {
  let s = n.toFixed(prec);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/**
 * encoding/json-shaped projection. Garmin MCP handlers marshal Go structs
 * (zero-filled, omitempty, wrapper field names) with MarshalIndent, not the raw body.
 */

export class GarminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GarminError";
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new GarminError(errorMessage(err));
  }
}

/** MarshalIndent("", "  ") plus encoding/json's HTML escapes. */
export function goJSON(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return text.replace(/[&<>\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export type Shape
  = | { k: "str" }
    | { k: "num" }
    | { k: "int" }
    | { k: "bool" }
    | { k: "ptr" }
    | { k: "any" }
    | { k: "obj"; fields: Field[] }
    | { k: "ptrObj"; fields: Field[] }
    | { k: "arr"; of: Shape }
    | { k: "arrPrim"; prim: "str" | "int" | "num" | "any" }
    | { k: "matrix"; prim: "int" | "any" }
    | { k: "map"; of: Shape };

export type Field = { key: string; shape: Shape; omit?: boolean };

export const str: Shape = { k: "str" };
export const num: Shape = { k: "num" };
export const int: Shape = { k: "int" };
export const bool: Shape = { k: "bool" };
export const ptr: Shape = { k: "ptr" };
export const anyShape: Shape = { k: "any" };
export const strs: Shape = { k: "arrPrim", prim: "str" };
export const ints: Shape = { k: "arrPrim", prim: "int" };
export const anys: Shape = { k: "arrPrim", prim: "any" };
export const matrixInt: Shape = { k: "matrix", prim: "int" };
export const matrixAny: Shape = { k: "matrix", prim: "any" };

export function obj(fields: Array<[string, Shape] | [string, Shape, "omit"]>): Shape {
  return {
    k: "obj",
    fields: fields.map(([key, shape, omit]) => ({ key, shape, omit: omit === "omit" })),
  };
}

export function ptrObj(shape: Shape): Shape {
  if (shape.k !== "obj") {
    throw new GarminError("ptrObj requires an object shape");
  }
  return { k: "ptrObj", fields: shape.fields };
}

export function arr(of: Shape): Shape {
  return { k: "arr", of };
}

/** encoding/json map: nil is null, keys sort alphabetically. */
export function mapOf(of: Shape): Shape {
  return { k: "map", of };
}

function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function cannot(value: unknown, into: string): never {
  throw new GarminError(`json: cannot unmarshal ${kind(value)} into Go value of type ${into}`);
}

/** omitempty: nil pointers are empty; a pointer to 0 is not. Bare numbers use 0. */
function omitEmpty(shape: Shape, value: unknown): boolean {
  switch (shape.k) {
    case "ptr":
    case "ptrObj":
    case "any":
      return value == null;
    case "arr":
    case "arrPrim":
    case "matrix":
      return value == null || (Array.isArray(value) && value.length === 0);
    case "map":
      return value == null || (isRecord(value) && Object.keys(value).length === 0);
    case "str":
      return value === "";
    case "num":
    case "int":
      return value === 0;
    case "bool":
      return value === false;
    default:
      return false;
  }
}

function projectInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) cannot(value, "int");
  return value;
}

export function project(value: unknown, shape: Shape): unknown {
  switch (shape.k) {
    case "str":
      if (value === undefined) return "";
      if (typeof value !== "string") cannot(value, "string");
      return value;
    case "num":
      if (value === undefined) return 0;
      if (typeof value !== "number") cannot(value, "float64");
      return value;
    case "int":
      if (value === undefined) return 0;
      return projectInt(value);
    case "bool":
      if (value === undefined) return false;
      if (typeof value !== "boolean") cannot(value, "bool");
      return value;
    case "ptr":
      if (value === undefined || value === null) return null;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      cannot(value, "pointer");
      return null;
    case "any":
      return value === undefined ? null : value;
    case "obj":
      return projectObj(value, shape.fields);
    case "ptrObj":
      if (value === undefined || value === null) return null;
      return projectObj(value, shape.fields);
    case "arr":
      if (value === undefined || value === null) return null;
      if (!Array.isArray(value)) cannot(value, "slice");
      return value.map((item) => project(item, shape.of));
    case "arrPrim": {
      if (value === undefined || value === null) return null;
      if (!Array.isArray(value)) cannot(value, "slice");
      const prim: Shape = shape.prim === "str" ? str : shape.prim === "int" ? int : shape.prim === "num" ? num : anyShape;
      return value.map((item) => project(item, prim));
    }
    case "matrix": {
      if (value === undefined || value === null) return null;
      if (!Array.isArray(value)) cannot(value, "slice");
      const rows: unknown[] = [];
      for (const row of value) rows.push(row);
      return rows.map((row) => {
        if (!Array.isArray(row)) cannot(row, "slice");
        if (shape.prim === "any") {
          const cells: unknown[] = [];
          for (const cell of row) cells.push(cell);
          return cells;
        }
        return row.map((cell) => projectInt(cell));
      });
    }
    case "map": {
      if (value === undefined || value === null) return null;
      if (!isRecord(value)) cannot(value, "map");
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) out[key] = project(value[key], shape.of);
      return out;
    }
    default:
      return null;
  }
}

function projectObj(value: unknown, fields: Field[]): Record<string, unknown> {
  if (value === undefined) value = {};
  if (!isRecord(value)) cannot(value, "struct");
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const projected = project(value[field.key], field.shape);
    if (field.omit && omitEmpty(field.shape, projected)) continue;
    out[field.key] = projected;
  }
  return out;
}

export function projectText(text: string, shape: Shape): unknown {
  return project(parseJson(text), shape);
}

/** Array responses that Go unmarshals into an exported field (`Entries`, `Events`). */
export function projectNamedList(text: string, field: string, item: Shape): unknown {
  const parsed = parseJson(text);
  if (!Array.isArray(parsed)) cannot(parsed, "slice");
  return { [field]: parsed.map((row) => project(row, item)) };
}

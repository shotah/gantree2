export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Overrides `Array.isArray`'s narrowing to `any[]`. */
export function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export function faceRevFromUnknown(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "face" || typeof o.text !== "string") {
    return null;
  }
  const n = Number(o.text);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function displaySlug(slug: string): string {
  const s = slug.trim();
  if (!s) {
    return "Agent";
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

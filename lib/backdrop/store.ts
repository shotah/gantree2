/** Chat wallpaper behind the thread. Same shape as the face: one JPEG per slug on the Durable Object. */

/** SQLite-backed Durable Object rows cap at 2 MB (key + value). Same budget as one chat photo. */
export const BACKDROP_MAX_BYTES = 1_500_000;
export const BACKDROP_TOO_LARGE = "image too large (max 1.5MB)";

/** `rev` (0 = cleared) from an incoming frame, or null when it is not a backdrop notice. */
export function backdropRevFromUnknown(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "backdrop" || typeof o.rev !== "number") {
    return null;
  }
  return Number.isSafeInteger(o.rev) && o.rev >= 0 ? o.rev : null;
}

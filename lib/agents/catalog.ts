/**
 * Tools baked into the image, in lock order. `oauth` is the `/auth` paste
 * flow (google, google-health, strava). Garmin's `/auth` is MFA, not this flag.
 */
import type { ToolEntry } from "./types";
import { loadLock, type LockRow } from "./lock";

const OAUTH_PASTE = new Set(["google", "google-health", "strava"]);

export function toolCatalog(rows: readonly LockRow[] = loadLock()): ToolEntry[] {
  return rows.map((row) => ({
    id: row.id,
    binary: row.binary,
    needs: [...row.needs],
    oauth: OAUTH_PASTE.has(row.id),
    homeOnly: row.homeOnly,
  }));
}

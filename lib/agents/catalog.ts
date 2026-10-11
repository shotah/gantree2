/**
 * Tools baked into the image, in lock order. `oauth` is the Worker catch
 * redirect (google, google-health, strava). Garmin's `/auth` is MFA, not this flag.
 */
import type { ToolEntry } from "./types";
import { loadLock, type LockRow } from "./lock";
import { oauthRedirectPlugin } from "./oauth";

export function toolCatalog(rows: readonly LockRow[] = loadLock()): ToolEntry[] {
  return rows.map((row) => ({
    id: row.id,
    binary: row.binary,
    needs: [...row.needs],
    oauth: oauthRedirectPlugin(row.id),
    homeOnly: row.homeOnly,
  }));
}

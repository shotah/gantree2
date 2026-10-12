/**
 * Model-facing tool results. `maxChars` counts Unicode code points (Go
 * runes), not UTF-8 bytes. `maxChars <= 0` leaves the string alone.
 * The marker is the same text the Go host appended, including the leading
 * newline, so a machine consumer can tell a cut JSON blob from a real one.
 */
export const TRUNCATION_MARKER = "\n…[truncated]";

/** Default `TOOL_RESULT_MAX_CHARS` from the Go harness config. */
export const DEFAULT_RESULT_MAX_CHARS = 6000;

export function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0 || value === "") {
    return value;
  }
  const runes = Array.from(value);
  if (runes.length <= maxChars) {
    return value;
  }
  const markerRunes = Array.from(TRUNCATION_MARKER);
  let keep = maxChars - markerRunes.length;
  if (keep < 1) {
    keep = 1;
  }
  if (keep > runes.length) {
    keep = runes.length;
  }
  return runes.slice(0, keep).join("") + TRUNCATION_MARKER;
}

/** Wire limits. Photos are the quota bomb; text stays small. */

export const TEXT_MAX = 8_000;
export const CONTEXT_JSON_MAX = 2_048;
export const IMAGE_MAX = 1;
export const IMAGE_BYTES_MAX = 1_500_000;
export const FRAME_BYTES_MAX = 2_000_000;
export const QUEUE_MAX = 50;
/** Total queued bytes per destination key `(to, userId||"")`. */
export const QUEUE_BYTES_MAX = 8 * 1024 * 1024;
export const QUEUE_TTL_MS = 60 * 60 * 1000;
/** Last N phone bubbles per `sub`. Matches Cab `THREAD_MAX`. Queue TTL is not this. */
export const TRANSCRIPT_MAX = 80;
export const TRANSCRIPT_BYTES_MAX = QUEUE_BYTES_MAX;
export const RATE_FRAMES_PER_MIN = 30;
/** Sustained refill. Text is a few hundred bytes; this only bites on photo sprees. */
export const RATE_BYTES_PER_MIN = 256_000;
/** Bucket depth. Must hold a full photo frame or no legal photo ever passes; two so a pair sends. */
export const RATE_BYTES_BURST = 2 * FRAME_BYTES_MAX;

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/** True when Content-Length is present and over the cap. Missing length is not a pass. */
export function headerSaysTooLarge(contentLength: string | null | undefined, max: number): boolean {
  const n = Number(contentLength ?? "NaN");
  return Number.isFinite(n) && n > max;
}

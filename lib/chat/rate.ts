import { RATE_BYTES_BURST, RATE_BYTES_PER_MIN, RATE_FRAMES_PER_MIN } from "./caps";

export type Bucket = { tokens: number; updated: number };

const MINUTE = 60_000;

export function takeTokens(
  bucket: Bucket | undefined,
  now: number,
  cost: number,
  opts: { rate: number; burst: number },
): { ok: boolean; bucket: Bucket } {
  const ratePerMs = opts.rate / MINUTE;
  const prev = bucket ?? { tokens: opts.burst, updated: now };
  const elapsed = Math.max(0, now - prev.updated);
  const tokens = Math.min(opts.burst, prev.tokens + elapsed * ratePerMs);
  if (tokens < cost) {
    return { ok: false, bucket: { tokens, updated: now } };
  }
  return { ok: true, bucket: { tokens: tokens - cost, updated: now } };
}

export type DualLimit = {
  frames: Bucket;
  bytes: Bucket;
};

export function takeFrame(
  limits: DualLimit | undefined,
  now: number,
  bytes: number,
): { ok: boolean; limits: DualLimit } {
  const frames = takeTokens(limits?.frames, now, 1, {
    rate: RATE_FRAMES_PER_MIN,
    burst: RATE_FRAMES_PER_MIN,
  });
  const byte = takeTokens(limits?.bytes, now, bytes, {
    rate: RATE_BYTES_PER_MIN,
    burst: RATE_BYTES_BURST,
  });
  const next = { frames: frames.bucket, bytes: byte.bucket };
  return { ok: frames.ok && byte.ok, limits: next };
}

export const RATE_IDLE_MS = 60_000;

export function pruneDualLimits(
  all: Record<string, DualLimit>,
  now: number,
  idleMs = RATE_IDLE_MS,
): Record<string, DualLimit> {
  const next: Record<string, DualLimit> = {};
  for (const [key, limits] of Object.entries(all)) {
    const updated = Math.max(limits.frames.updated, limits.bytes.updated);
    if (now - updated <= idleMs) {
      next[key] = limits;
    }
  }
  return next;
}

export function principalKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

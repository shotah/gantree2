import { createHash, timingSafeEqual } from "node:crypto";

/** Compare secrets without leaking length via early return on the digest. */
export function secretEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

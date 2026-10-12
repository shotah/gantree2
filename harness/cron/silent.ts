import { SilentToken } from "./constants";

/** First non-empty line is `[silent]` (any case). Later lines are a reason and do not count. */
export function isSilentReply(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  const nl = trimmed.indexOf("\n");
  const line = (nl >= 0 ? trimmed.slice(0, nl) : trimmed).trim();
  return line.toLowerCase() === SilentToken.toLowerCase();
}

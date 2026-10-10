import type { PhoneContext } from "@/lib/chat/frame";
import { readNet } from "@/lib/phone/net";

type NavNet = Navigator & { connection?: { type?: string; effectiveType?: string } };

export function browserNet(): PhoneContext["net"] | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }
  return readNet((navigator as NavNet).connection);
}

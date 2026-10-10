import { bumpBadge, clearBadgeCount, shouldBadge } from "@/lib/phone/badge";

export function browserBumpBadge(count: number, kind: string | undefined): number {
  if (typeof document === "undefined" || typeof navigator === "undefined") {
    return count;
  }
  if (!shouldBadge(document.hidden, kind)) {
    return count;
  }
  return bumpBadge(count, navigator);
}

export function browserClearBadge(): 0 {
  if (typeof navigator === "undefined") {
    return 0;
  }
  return clearBadgeCount(navigator);
}

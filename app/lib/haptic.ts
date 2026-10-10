import { buzzPush } from "@/lib/phone/haptic";

export function browserBuzzPush(kind?: string): void {
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    return;
  }
  buzzPush({
    kind,
    hidden: document.hidden,
    vibrate: typeof navigator.vibrate === "function" ? (p) => navigator.vibrate(p) : undefined,
  });
}

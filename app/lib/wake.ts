import { releaseScreenWake, requestScreenWake, type WakeLockSentinel } from "@/lib/phone/wake";

type NavWake = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

export function browserWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === "undefined") {
    return Promise.resolve(null);
  }
  return requestScreenWake((navigator as NavWake).wakeLock);
}

export { releaseScreenWake };
export type { WakeLockSentinel };

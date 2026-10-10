import { readBattery, type BatteryResult } from "@/lib/phone/battery";

type NavBat = Navigator & {
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
};

export function browserBattery(): Promise<BatteryResult> {
  if (typeof navigator === "undefined") {
    return Promise.resolve({ ok: false });
  }
  const getBattery = (navigator as NavBat).getBattery?.bind(navigator);
  return readBattery(getBattery);
}

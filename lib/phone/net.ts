import type { PhoneContext } from "../chat/frame";

export type ConnectionInfo = {
  type?: string;
  effectiveType?: string;
};

const WIFI = new Set(["wifi", "ethernet", "wimax"]);
const CELL = new Set(["slow-2g", "2g", "3g", "4g"]);

/** Map Network Information API → wire `net`. Missing API → omit. Never SSID. */
export function readNet(conn: ConnectionInfo | null | undefined): PhoneContext["net"] | undefined {
  if (!conn) {
    return undefined;
  }
  const type = (conn.type ?? "").toLowerCase();
  if (WIFI.has(type)) {
    return "wifi";
  }
  if (type === "cellular") {
    return "cellular";
  }
  if (type === "none") {
    return undefined;
  }
  const effective = (conn.effectiveType ?? "").toLowerCase();
  if (CELL.has(effective)) {
    return "cellular";
  }
  if (type || effective) {
    return "unknown";
  }
  return undefined;
}

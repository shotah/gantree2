import { PACKAGE_VERSION } from "@/app/lib/release";
import { json } from "@/lib/door/http";

/** Public liveness check. No session. */
export function GET(): Response {
  return json({ ok: true, version: PACKAGE_VERSION, time: new Date().toISOString() });
}

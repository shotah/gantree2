import { requestMicAccess } from "@/lib/phone/mic";
import type { DevicePermission } from "@/lib/phone/permit";

export async function browserAskMic(): Promise<DevicePermission> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }
  return requestMicAccess((c) => navigator.mediaDevices.getUserMedia(c));
}

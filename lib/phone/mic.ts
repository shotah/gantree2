import type { DevicePermission } from "./permit";

export type MicTrack = { stop(): void };
export type MicStream = { getTracks(): MicTrack[] };
export type GetUserMedia = (c: { audio: true }) => Promise<MicStream>;

/**
 * Prompt for the microphone, then stop the tracks so the LED does not stay on.
 * Hold-to-talk still uses Web Speech; this is only the permission gate.
 */
export async function requestMicAccess(gum: GetUserMedia | undefined): Promise<DevicePermission> {
  if (typeof gum !== "function") {
    return "unsupported";
  }
  try {
    const stream = await gum({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return "granted";
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "unsupported";
    }
    return "denied";
  }
}

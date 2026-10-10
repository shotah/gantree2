/** Browser permission state we can show in Settings. `prompt` includes "not queried yet". */

export type DevicePermission = "granted" | "denied" | "prompt" | "unsupported";

export function readDevicePermission(state: unknown): DevicePermission {
  if (state === "granted" || state === "denied" || state === "prompt") {
    return state;
  }
  return "unsupported";
}

export function blockedHint(permission: DevicePermission): string {
  if (permission === "unsupported") {
    return "Not available in this browser.";
  }
  if (permission === "denied") {
    return "Blocked — enable in system settings.";
  }
  return "";
}

/**
 * Chrome `permissions.query("microphone")` often says denied before this
 * origin has been asked (absent from the allow list is still promptable).
 * Only getUserMedia / Web Speech `not-allowed` is a real no. Query granted
 * is real.
 */
export function micAskState(queried: DevicePermission, asked: DevicePermission | null): DevicePermission {
  if (asked === "granted" || queried === "granted") {
    return "granted";
  }
  if (asked === "unsupported") {
    return "unsupported";
  }
  if (asked === "denied") {
    return "denied";
  }
  return "prompt";
}

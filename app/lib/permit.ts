"use client";

import { useEffect, useState } from "react";
import { readDevicePermission, type DevicePermission } from "@/lib/phone/permit";

export type PermitName = "microphone" | "geolocation";

/** Live OS permission. Starts as `prompt` until `permissions.query` answers (or never, on old browsers). */
export function useDevicePermission(name: PermitName): DevicePermission {
  const [state, setState] = useState<DevicePermission>("prompt");

  useEffect(() => {
    const perms = typeof navigator === "undefined" ? undefined : navigator.permissions;
    if (!perms || typeof perms.query !== "function") {
      return;
    }
    let status: PermissionStatus | undefined;
    let dead = false;
    void perms.query({ name })
      .then((next) => {
        if (dead) {
          return;
        }
        status = next;
        setState(readDevicePermission(next.state));
        next.onchange = () => {
          setState(readDevicePermission(next.state));
        };
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      if (status) {
        status.onchange = null;
      }
    };
  }, [name]);

  return state;
}
